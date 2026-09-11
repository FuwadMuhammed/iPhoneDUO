import './styles.css';
import { MathUtils, Vector3 } from 'three';
import { loadFoldable, type Foldable } from './device/foldable';
import { HIGHLIGHTS, type Highlight } from './device/highlights';
import { loadLockScreen, loadStaticImage, paintCustomImage } from './device/screens';
import { createStage, type Offset, type PoseAngles, type Stage, type StageView } from './stage/stage';
import { createRail } from './ui/rail';
import { Notice, Uploader } from './components';
const SLIDER_STEPS = 1000;
const SETTLE_SECONDS = 1.15;
const ARRIVAL_SECONDS = 2.2;
const MAX_STEP_SECONDS = 1 / 20;
const CLICK_TOLERANCE = 4;
const FOLD_DAMPING = 4.5;
const SETTLED_MARGIN = 0.02;
const NOTICE_SECONDS = 4.2;
const PARALLAX_FALLOFF = 1.5;
const FADE_START = 0.2;
const FADE_END = 0.8;
const FADE_SECONDS = 0.6;
const ARRIVAL_POSE: PoseAngles = [0, Math.PI * 0.75, 0];
const ARRIVAL_VIEW: StageView = { distance: 34, pitch: 1.53, yaw: 0.3 };
interface Settle {
  readonly highlight: Highlight;
  readonly fromOpenness: number | null;
  readonly fromView: StageView;
  readonly fromPose: PoseAngles;
  readonly fromOffset: Offset;
  readonly seconds: number;
  elapsed: number;
}
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element "${selector}".`);
  return found;
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
const host = element<HTMLElement>('#stage');
const rack = element<HTMLElement>('#highlights');
const list = element<HTMLElement>('#highlight-list');
const previousButton = element<HTMLButtonElement>('#previous-highlight');
const nextButton = element<HTMLButtonElement>('#next-highlight');
const notice = new Notice('#notice');
const uploader = new Uploader('#upload', '#upload-file', '#reset-upload');
async function boot(): Promise<void> {
  let stage: Stage;
  try {
    stage = createStage(host, rack);
  } catch {
    notice.show('This browser could not start WebGL, so the device cannot be drawn.');
    return;
  }
  let foldable: Foldable;
  let steleImage: HTMLCanvasElement;
  try {
    const [lockScreen, promoImage] = await Promise.all([
      loadLockScreen(),
      loadStaticImage(`${import.meta.env.BASE_URL}assets/stele.webp`),
    ]);
    steleImage = promoImage;
    foldable = await loadFoldable(
      lockScreen,
      stage.renderer.capabilities.getMaxAnisotropy(),
      stage.scene.environment,
    );
  } catch (error) {
    console.error(error);
    notice.show('The device model could not be loaded. Refresh the page to try again.');
    return;
  }
  stage.content.add(foldable.root);
  let openness = HIGHLIGHTS[0]!.openness;
  let foldTarget = openness;
  let settle: Settle | null = null;
  let hasCustomUpload = false;
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
    stage.applyView(highlight.view);
    stage.setPose(highlight.pose);
    stage.setOffset(offsetOf(highlight));
    stage.setOrbitEnabled(orbitAllowed());
  }
  function settleOn(highlight: Highlight, { seconds = SETTLE_SECONDS, keepOpenness = false } = {}): void {
    foldable.setRoll(highlight.roll ?? null, highlight.screen ?? 'inner');
    foldable.setFocus(highlight.screen ?? null);
    if (!hasCustomUpload) {
      if (highlight.image === 'stele') foldable.showImage(steleImage);
      else foldable.clearImage();
    }
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
    stage.applyView({
      distance: MathUtils.lerp(fromView.distance, highlight.view.distance, eased),
      pitch: MathUtils.lerp(fromView.pitch, highlight.view.pitch, eased),
      yaw: turn(fromView.yaw, highlight.view.yaw, eased),
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
  const rail = createRail(list, previousButton, nextButton, (highlight) => settleOn(highlight));
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
    if (target) settleOn(target);
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
      canvas.classList.toggle('is-grabbable', stage.hitsContent(event.clientX, event.clientY));
      return;
    }
    if (event.pointerId !== press.pointerId) return;
    press.lastX = event.clientX;
    press.lastY = event.clientY;
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (press.engaged || !press.onModel || stage.orbitEnabled() || travel <= CLICK_TOLERANCE) return;
    press.engaged = true;
    engage(press.from);
  });
  canvas.addEventListener('pointerleave', () => {
    if (!press) canvas.classList.remove('is-grabbable');
  });
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerup', (event) => {
    if (!press) return;
    const travel = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const { onModel, from, engaged } = press;
    release();
    canvas.classList.toggle('is-grabbable', stage.hitsContent(event.clientX, event.clientY));
    if (engaged || travel > CLICK_TOLERANCE || !onModel) return;
    engage(from);
  });
  uploader.onChange(async (file) => {
    try {
      const canvas = await paintCustomImage(file);
      hasCustomUpload = true;
      foldable.showImage(canvas);
      uploader.setCustom(true);
      rail.select(HIGHLIGHTS[1]!);
    } catch {
      notice.show('Unable to read this image. Choose a PNG, JPG, or WebP file.', NOTICE_SECONDS);
    }
  });
  uploader.onReset(() => {
    hasCustomUpload = false;
    if (rail.current.image === 'stele') foldable.showImage(steleImage);
    else foldable.clearImage();
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
  rail.slider.disabled = false;
  uploader.setDisabled(false);
  settleOn(HIGHLIGHTS[0]!, { seconds: ARRIVAL_SECONDS });  let previous = performance.now();
  stage.renderer.setAnimationLoop((now) => {
    const step = Math.min((now - previous) / 1000, MAX_STEP_SECONDS);
    previous = now;
    advance(step);
    if (!settle) foldable.advanceBlend(step / FADE_SECONDS);
    if (!settle && Math.abs(foldTarget - openness) > 0.0005) {
      setOpenness(MathUtils.damp(openness, foldTarget, FOLD_DAMPING, step));
      stage.setOrbitEnabled(orbitAllowed());
    }
    handOff();
    trackViewpoint();
    foldable.render(stage.renderer);
    stage.render();
  });
}
void boot();
