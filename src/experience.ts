import { MathUtils, Vector3 } from 'three';
import type { Loader, Notice } from './components';
import { createFoldable, loadModel, type Foldable } from './device/foldable';
import { HIGHLIGHTS, type Highlight } from './device/highlights';
import { loadLockScreen, type ScreenPanel, type ScreenTurn } from './device/screens';
import { createStage, type Offset, type PoseAngles, type Stage, type StageView } from './stage/stage';
import type { Rail } from './ui/rail';
const SLIDER_STEPS = 1000;
const SETTLE_SECONDS = 1.15;
const TAP_SETTLE_SECONDS = 1.6;
const NUDGE_DAMPING = 10;
const ARRIVAL_SECONDS = 2.2;
const MAX_STEP_SECONDS = 1 / 20;
const CLICK_TOLERANCE = 4;
const FOLD_DAMPING = 4.5;
const SETTLED_MARGIN = 0.02;
const PARALLAX_FALLOFF = 1.5;
const FADE_START = 0.2;
const FADE_END = 0.8;
const FADE_SECONDS = 0.6;
const ARRIVAL_POSE: PoseAngles = [0, Math.PI * 0.75, 0];
const ARRIVAL_VIEW: StageView = { distance: 34, pitch: 1.53, yaw: 0.3 };
// Share of the loading bar each phase fills; the model download dominates.
const IMAGES_SHARE = 0.15;
const MODEL_SHARE = 0.7;
interface Settle {
  readonly highlight: Highlight;
  readonly fromOpenness: number | null;
  readonly fromView: StageView;
  readonly fromPose: PoseAngles;
  readonly fromOffset: Offset;
  readonly seconds: number;
  elapsed: number;
}
export interface ExperienceOptions {
  readonly host: HTMLElement;
  readonly rack: HTMLElement;
  readonly rail: Rail;
  readonly notice: Notice;
  readonly loader: Loader;
  bindSelect(handler: (highlight: Highlight) => void): void;
}
// One upload slot per highlight, described so the upload UI can label it and show the exact pixel box
// to prepare artwork at. Published on window once the experience is ready — see the bottom of start().
export interface MockupImageTarget {
  readonly id: string;
  readonly label: string;
  readonly panel: ScreenPanel;
  readonly turn: ScreenTurn;
}
export interface MockupBridge {
  readonly targets: readonly MockupImageTarget[];
  setImage(id: string, image: HTMLCanvasElement | null): void;
  select(id: string): void;
  current(): { readonly id: string; readonly label: string };
  isSettling(): boolean;
  // One frame of the stage at `scale` × the live pixel ratio, copied to a 2D canvas (alpha preserved).
  renderStill(scale: number): HTMLCanvasElement;
}
declare global {
  interface WindowEventMap {
    'iphoneduo:bridge': CustomEvent<MockupBridge>;
  }
}
function easeInOut(progress: number): number {
  return progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
}
function offsetOf(highlight: Highlight): Offset {
  return [highlight.shift ?? 0, highlight.lift ?? 0];
}
function turn(from: number, to: number, amount: number): number {
  const delta = MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
  return from + delta * amount;
}
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
export async function start({ host, rack, rail, notice, loader, bindSelect }: ExperienceOptions): Promise<void> {
  let imagesDone = 0;
  let modelDone = 0;
  const report = (message: string): void =>
    loader.setProgress(0.02 + IMAGES_SHARE * imagesDone + MODEL_SHARE * modelDone, message);
  // Start every download before touching WebGL: creating the renderer and its environment map blocks the
  // main thread, and the model and lock screen artwork download side by side rather than one after another.
  const downloads = Promise.all([
    loadModel((fraction) => {
      modelDone = fraction;
      report(fraction < 1 ? 'Loading 3D model' : 'Loading textures');
    }),
    loadLockScreen().then((screen) => {
      imagesDone = 1;
      report('Loading 3D model');
      return screen;
    }),
  ]);
  downloads.catch(() => {});
  // Let the menu and loader paint before the renderer set-up claims the main thread.
  await nextFrame();
  let stage: Stage;
  try {
    stage = createStage(host, rack);
  } catch {
    loader.fail('WebGL is not available.');
    notice.show('This browser could not start WebGL, so the device cannot be drawn.');
    return;
  }
  let foldable: Foldable;
  try {
    const [model, lockScreen] = await downloads;
    modelDone = 1;
    report('Preparing device');
    await nextFrame();
    foldable = createFoldable(model, lockScreen, stage.renderer.capabilities.getMaxAnisotropy(), stage.scene.environment);
    stage.content.add(foldable.root);
    loader.setProgress(0.92, 'Preparing device');
    // Compile shaders up front (in parallel where the GPU driver allows) so the first frames don't stall.
    await stage.renderer.compileAsync(stage.scene, stage.camera);
  } catch (error) {
    console.error(error);
    loader.fail('The model could not be loaded.');
    notice.show('The device model could not be loaded. Refresh the page to try again.');
    return;
  }
  let openness = HIGHLIGHTS[0]!.openness;
  let foldTarget = openness;
  let settle: Settle | null = null;
  let showing = rail.current;
  const nudge = { yaw: 0, pitch: 0, shownYaw: 0, shownPitch: 0 };
  // One canvas per highlight id, already baked to that highlight's exact panel/orientation by the
  // mockup module (see MockupBridge below) — applying one is just picking it up when it becomes current.
  const customImages = new Map<string, HTMLCanvasElement>();
  // The header shows one of two lines: the getting-started hint while nothing is uploaded, or the
  // reset-all action once something is.
  const emptyHint = document.getElementById('empty-hint');
  const resetAll = document.getElementById('reset-all-uploads');
  function updateEmptyHint(): void {
    const empty = customImages.size === 0;
    if (emptyHint) emptyHint.hidden = !empty;
    if (resetAll) resetAll.hidden = empty;
  }
  function applyHighlightImage(highlight: Highlight): void {
    const image = customImages.get(highlight.id) ?? null;
    if (highlight.adjustable) {
      // The fold view spans one wallpaper across both halves, so a custom image covers both panels too.
      foldable.setImage('inner', image);
      foldable.setImage('outer', image);
      return;
    }
    const primary = highlight.screen ?? 'inner';
    foldable.setImage(primary, image);
    foldable.setImage(primary === 'inner' ? 'outer' : 'inner', null);
  }
  function setOpenness(value: number): void {
    openness = value;
    foldable.setOpenness(value);
    if (document.activeElement !== rail.slider) rail.slider.value = String(Math.round(value * SLIDER_STEPS));
  }
  function orbitAllowed(): boolean {
    return !settle && (openness <= SETTLED_MARGIN || openness >= 1 - SETTLED_MARGIN);
  }
  function arrive(highlight: Highlight, keepOpenness: boolean): void {
    settle = null;
    foldable.setBlend(1);
    if (!keepOpenness) {
      setOpenness(highlight.openness);
      foldTarget = highlight.openness;
    }
    stage.applyView({
      distance: highlight.view.distance,
      pitch: highlight.view.pitch + nudge.shownPitch,
      yaw: highlight.view.yaw + nudge.shownYaw,
    });
    nudge.yaw = nudge.pitch = nudge.shownYaw = nudge.shownPitch = 0;
    stage.setPose(highlight.pose);
    stage.setOffset(offsetOf(highlight));
    stage.setOrbitEnabled(orbitAllowed());
  }
  function settleOn(highlight: Highlight, { seconds = SETTLE_SECONDS, keepOpenness = false } = {}): void {
    showing = highlight;
    nudge.yaw = nudge.pitch = nudge.shownYaw = nudge.shownPitch = 0;
    foldable.setRoll(highlight.roll ?? null, highlight.screen ?? 'inner');
    foldable.setFocus(highlight.screen ?? null);
    applyHighlightImage(highlight);
    if (seconds <= 0) {
      arrive(highlight, keepOpenness);
      return;
    }
    settle = {
      highlight,
      fromOpenness: keepOpenness ? null : openness,
      fromView: stage.readView(),
      fromPose: stage.readPose(),
      fromOffset: stage.readOffset(),
      seconds,
      elapsed: 0,
    };
    stage.setOrbitEnabled(false);
  }
  function advance(step: number): void {
    if (!settle) return;
    settle.elapsed += step;
    const progress = Math.min(settle.elapsed / settle.seconds, 1);
    const eased = easeInOut(progress);
    foldable.setBlend(MathUtils.smoothstep(progress, FADE_START, FADE_END));
    const { highlight, fromView, fromPose, fromOffset, fromOpenness } = settle;
    if (fromOpenness !== null) setOpenness(MathUtils.lerp(fromOpenness, highlight.openness, eased));
    nudge.shownYaw = MathUtils.damp(nudge.shownYaw, nudge.yaw, NUDGE_DAMPING, step);
    nudge.shownPitch = MathUtils.damp(nudge.shownPitch, nudge.pitch, NUDGE_DAMPING, step);
    stage.applyView({
      distance: MathUtils.lerp(fromView.distance, highlight.view.distance, eased),
      pitch: MathUtils.lerp(fromView.pitch, highlight.view.pitch, eased) + nudge.shownPitch,
      yaw: turn(fromView.yaw, highlight.view.yaw, eased) + nudge.shownYaw,
    });
    stage.setPose([
      turn(fromPose[0], highlight.pose[0], eased),
      turn(fromPose[1], highlight.pose[1], eased),
      turn(fromPose[2], highlight.pose[2], eased),
    ]);
    const offset = offsetOf(highlight);
    stage.setOffset([
      MathUtils.lerp(fromOffset[0], offset[0], eased),
      MathUtils.lerp(fromOffset[1], offset[1], eased),
    ]);
    if (progress === 1) arrive(highlight, fromOpenness === null);
  }
  bindSelect((highlight) => settleOn(highlight));
  rail.slider.addEventListener('pointerdown', () => {
    stage.setOrbitEnabled(false);
    settleOn(rail.current, { keepOpenness: true });
  });
  rail.slider.addEventListener('input', () => {
    if (settle?.fromOpenness === null) settle = null;
    stage.setOrbitEnabled(false);
    foldTarget = Number(rail.slider.value) / SLIDER_STEPS;
  });
  const canvas = stage.renderer.domElement;
  interface Press {
    readonly x: number;
    readonly y: number;
    readonly pointerId: number;
    readonly pointerType: string;
    readonly onModel: boolean;
    readonly from: Highlight;
    lastX: number;
    lastY: number;
    engaged: boolean;
    handedOff: boolean;
  }
  let press: Press | null = null;
  let handingOff = false;
  function engage(from: Highlight): void {
    if (from.adjustable) {
      foldTarget = openness >= 0.5 ? 1 : 0;
      settle = null;
      return;
    }
    const target = HIGHLIGHTS.find((entry) => entry.id === from.tapTarget);
    if (target && showing !== target) settleOn(target, { seconds: TAP_SETTLE_SECONDS });
  }
  // A drag that engaged interactive mode keeps going: once orbiting unlocks, replay the press so the
  // controls pick up the same gesture instead of waiting for the next one.
  function handOff(): void {
    if (!press?.engaged || press.handedOff || !stage.orbitEnabled()) return;
    press.handedOff = true;
    handingOff = true;
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: press.pointerId,
        pointerType: press.pointerType,
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: press.lastX,
        clientY: press.lastY,
        bubbles: true,
      }),
    );
    handingOff = false;
  }
  function release(): void {
    press = null;
    canvas.classList.remove('is-grabbing');
  }
  // Raycasting the full mesh is costly, so hover checks run at most once per frame.
  let hoverAt: { x: number; y: number } | null = null;
  function checkHover(): void {
    if (!hoverAt || press) return;
    canvas.classList.toggle('is-grabbable', stage.hitsContent(hoverAt.x, hoverAt.y));
    hoverAt = null;
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (handingOff) return;
    if (!event.isPrimary) {
      release();
      return;
    }
    const onModel = stage.hitsContent(event.clientX, event.clientY);
    press = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      onModel,
      from: rail.current,
      lastX: event.clientX,
      lastY: event.clientY,
      engaged: false,
      handedOff: false,
    };
    canvas.setPointerCapture(event.pointerId);
    if (onModel || stage.orbitEnabled()) canvas.classList.add('is-grabbing');
    rail.collapse();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!press) {
      if (event.pointerType === 'mouse') hoverAt = { x: event.clientX, y: event.clientY };
      return;
    }
    if (event.pointerId !== press.pointerId) return;
    if (press.engaged && settle && !stage.orbitEnabled()) {
      const turnPerPixel = (Math.PI * 2) / Math.max(canvas.clientHeight, 1);
      nudge.yaw -= (event.clientX - press.lastX) * turnPerPixel;
      nudge.pitch = MathUtils.clamp(
        nudge.pitch - (event.clientY - press.lastY) * turnPerPixel,
        -settle.highlight.view.pitch + 0.05,
        Math.PI - settle.highlight.view.pitch - 0.05,
      );
    }
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (press.engaged || !press.onModel || stage.orbitEnabled() || travel <= CLICK_TOLERANCE) return;
    press.engaged = true;
    engage(press.from);
  });
  canvas.addEventListener('pointerleave', () => {
    hoverAt = null;
    if (!press) canvas.classList.remove('is-grabbable');
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerup', (event) => {
    if (!press) return;
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const { onModel, from, engaged } = press;
    release();
    if (event.pointerType === 'mouse') hoverAt = { x: event.clientX, y: event.clientY };
    if (engaged || travel > CLICK_TOLERANCE || !onModel) return;
    engage(from);
  });
  const eye = new Vector3();
  function trackViewpoint(): void {
    eye.copy(stage.eyeInContent());
    const reach = eye.length();
    foldable.setViewpoint(eye, reach > 0 ? MathUtils.clamp(eye.z / reach, 0, 1) ** PARALLAX_FALLOFF : 1);
  }
  stage.setPose(ARRIVAL_POSE);
  stage.applyView(ARRIVAL_VIEW);
  setOpenness(0);
  foldTarget = 0;
  rail.unlock();
  // Announced on window rather than threaded through ExperienceOptions/main.ts, so the mockup module
  // (a separate entry point) can drive per-highlight uploads without this file knowing it exists.
  const bridge: MockupBridge = {
    targets: HIGHLIGHTS.map((highlight) => ({
      id: highlight.id,
      label: highlight.label,
      panel: highlight.screen ?? 'inner',
      turn: highlight.roll ?? 'none',
    })),
    setImage(id, image) {
      if (image) customImages.set(id, image);
      else customImages.delete(id);
      rail.markUploaded(id, image !== null);
      updateEmptyHint();
      const highlight = HIGHLIGHTS.find((entry) => entry.id === id);
      if (highlight && rail.current.id === id) applyHighlightImage(highlight);
    },
    select(id) {
      const highlight = HIGHLIGHTS.find((entry) => entry.id === id);
      if (highlight) rail.select(highlight);
    },
    current() {
      return { id: rail.current.id, label: rail.current.label };
    },
    isSettling() {
      return settle !== null;
    },
    renderStill(scale) {
      const renderer = stage.renderer;
      const ratio = renderer.getPixelRatio();
      const out = document.createElement('canvas');
      try {
        if (scale !== 1) renderer.setPixelRatio(ratio * scale);
        foldable.render(renderer);
        stage.render();
        // Read back in the same task as the render: the drawing buffer is still intact until the
        // browser composites, so this works without preserveDrawingBuffer.
        out.width = renderer.domElement.width;
        out.height = renderer.domElement.height;
        out.getContext('2d')?.drawImage(renderer.domElement, 0, 0);
      } finally {
        if (scale !== 1) {
          renderer.setPixelRatio(ratio);
          foldable.render(renderer);
          stage.render();
        }
      }
      return out;
    },
  };
  window.dispatchEvent(new CustomEvent('iphoneduo:bridge', { detail: bridge }));
  settleOn(rail.current, { seconds: ARRIVAL_SECONDS });
  let previous = performance.now();
  function frame(now: number): void {
    const step = Math.min((now - previous) / 1000, MAX_STEP_SECONDS);
    previous = now;
    advance(step);
    if (!settle) foldable.advanceBlend(step / FADE_SECONDS);
    if (!settle && Math.abs(foldTarget - openness) > 0.0005) {
      setOpenness(MathUtils.damp(openness, foldTarget, FOLD_DAMPING, step));
      stage.setOrbitEnabled(orbitAllowed());
    }
    handOff();
    checkHover();
    trackViewpoint();
    foldable.render(stage.renderer);
    stage.render();
  }
  // Draw the first frame before revealing the canvas so the fade-in never shows an empty stage.
  frame(previous);
  stage.renderer.setAnimationLoop(frame);
  await nextFrame();
  loader.done();
  foldable.warmUp();
}
