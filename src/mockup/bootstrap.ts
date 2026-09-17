// Wires the toolbar's Export button, the modal it opens, and renders the export controls into that
// modal's body; also kicks off the per-pose upload boxes (uploads.ts) once the 3D chunk is ready. The fold
// rig in src/device and src/stage is untouched — this only adds UI around it.
import './panel.css';
import { createModal } from './modals';
import {
  type Background,
  composeStill,
  exportStill,
  type ImageFormat,
  MockupRecorder,
  type VideoFormat,
  videoFormatSupported,
} from './capture';
import type { MockupBridge } from '../experience';
import { initUploads, whenBridgeReady } from './uploads';

const DEFAULT_COLOR = '#f9fafb'; // matches the viewer's --stage-backdrop, so Solid exports read the same as the on-screen border
const MAX_STILL_PIXELS = 40_000_000; // keeps 3× from allocating a canvas the GPU can't back on large retina viewports
const CAMERA_ICON =
  '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/>';
const RECORD_ICON = '<circle cx="12" cy="12" r="6"/>';

interface Segmented {
  readonly element: HTMLElement;
  readonly value: string;
  setValue(value: string): void;
  setDisabled(value: string, disabled: boolean, reason?: string): void;
  onChange(handler: (value: string) => void): void;
}

function createSegmented(values: readonly string[], labels: readonly string[], initial: string): Segmented {
  const element = document.createElement('div');
  element.className = 'mockup-segmented';
  const buttons = values.map((value, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.value = value;
    button.textContent = labels[index] ?? value;
    element.append(button);
    return button;
  });
  let current = initial;
  let changed: (value: string) => void = () => {};
  function paint(): void {
    for (const button of buttons) button.classList.toggle('is-active', button.dataset.value === current);
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (button.disabled || button.dataset.value === current) return;
      current = button.dataset.value ?? current;
      paint();
      changed(current);
    });
  }
  paint();
  return {
    element,
    get value() {
      return current;
    },
    setValue(value) {
      current = value;
      paint();
    },
    setDisabled(value, disabled, reason) {
      const button = buttons.find((entry) => entry.dataset.value === value);
      if (!button) return;
      button.disabled = disabled;
      button.title = disabled && reason ? reason : '';
    },
    onChange(handler) {
      changed = handler;
    },
  };
}

// One settings row: label on the left, control(s) on the right, optional hint underneath.
function field(labelText: string, ...controls: HTMLElement[]): { row: HTMLDivElement; hint: HTMLSpanElement } {
  const row = document.createElement('div');
  row.className = 'mockup-field';
  const label = document.createElement('span');
  label.className = 'mockup-field-label';
  label.textContent = labelText;
  const control = document.createElement('div');
  control.className = 'mockup-field-control';
  control.append(...controls);
  const hint = document.createElement('span');
  hint.className = 'mockup-field-hint';
  hint.hidden = true;
  row.append(label, control, hint);
  return { row, hint };
}

function iconButton(className: string, icon: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span>`;
  return button;
}

function statusLine(): HTMLSpanElement {
  const status = document.createElement('span');
  status.className = 'mockup-status';
  status.setAttribute('aria-live', 'polite');
  return status;
}

interface ExportPanel {
  readonly tabs: Segmented;
  readonly imagePane: HTMLDivElement;
  readonly videoPane: HTMLDivElement;
  readonly preview: HTMLDivElement;
  readonly previewImage: HTMLImageElement;
  readonly previewName: HTMLElement;
  readonly changePose: HTMLButtonElement;
  readonly poses: HTMLDivElement;
  readonly noImage: HTMLParagraphElement;
  readonly background: Segmented;
  readonly color: HTMLInputElement;
  readonly imageFormat: Segmented;
  readonly size: Segmented;
  readonly sizeHint: HTMLSpanElement;
  readonly exportButton: HTMLButtonElement;
  readonly imageStatus: HTMLSpanElement;
  readonly videoFormat: Segmented;
  readonly resolution: Segmented;
  readonly frameRate: Segmented;
  readonly recordButton: HTMLButtonElement;
  readonly videoStatus: HTMLSpanElement;
}

function buildExportPanel(root: HTMLElement): ExportPanel {
  const tabs = createSegmented(['image', 'video'], ['Image', 'Video'], 'image');
  tabs.element.classList.add('mockup-tabs');
  tabs.element.setAttribute('role', 'tablist');

  // Shared preview: the pose on screen right now is what either export captures.
  const previewSection = document.createElement('div');
  previewSection.className = 'mockup-preview-section';
  const preview = document.createElement('div');
  preview.className = 'mockup-preview';
  const previewImage = document.createElement('img');
  previewImage.alt = '';
  preview.append(previewImage);
  const previewRow = document.createElement('div');
  previewRow.className = 'mockup-preview-row';
  const previewName = document.createElement('span');
  previewName.className = 'mockup-preview-name';
  const changePose = document.createElement('button');
  changePose.type = 'button';
  changePose.className = 'mockup-link';
  changePose.textContent = 'Change pose';
  changePose.setAttribute('aria-expanded', 'false');
  previewRow.append(previewName, changePose);
  const poses = document.createElement('div');
  poses.className = 'mockup-poses';
  poses.hidden = true;
  const noImage = document.createElement('p');
  noImage.className = 'mockup-notice';
  noImage.hidden = true;
  previewSection.append(preview, previewRow, poses, noImage);

  const imagePane = document.createElement('div');
  imagePane.className = 'mockup-pane';
  const background = createSegmented(['transparent', 'solid'], ['Transparent', 'Solid'], 'transparent');
  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'mockup-swatch';
  color.value = DEFAULT_COLOR;
  color.disabled = true;
  color.setAttribute('aria-label', 'Background colour');
  const colorWrap = document.createElement('div');
  colorWrap.className = 'mockup-swatch-wrap';
  colorWrap.append(color);
  const imageFormat = createSegmented(['png', 'jpeg'], ['PNG', 'JPEG'], 'png');
  const size = createSegmented(['1', '2', '3'], ['1×', '2×', '3×'], '1');
  const sizeField = field('Size', size.element);
  const exportButton = iconButton('mockup-primary', CAMERA_ICON, 'Export as PNG');
  const imageStatus = statusLine();
  imagePane.append(
    field('Background', background.element, colorWrap).row,
    field('Format', imageFormat.element).row,
    sizeField.row,
    exportButton,
    imageStatus,
  );

  const videoPane = document.createElement('div');
  videoPane.className = 'mockup-pane';
  videoPane.hidden = true;
  const videoFormat = createSegmented(['webm', 'mp4'], ['WebM', 'MP4'], 'webm');
  const resolution = createSegmented(['source', '1080', '720'], ['Original', '1080p', '720p'], 'source');
  const frameRate = createSegmented(['30', '60'], ['30 fps', '60 fps'], '30');
  const recordTip = document.createElement('p');
  recordTip.className = 'mockup-tip';
  recordTip.textContent = 'Recording starts right away — move the phone however you like, then press Stop in the toolbar.';
  const recordButton = iconButton('mockup-primary mockup-primary--record', RECORD_ICON, 'Create Video');
  recordButton.querySelector('svg')?.classList.add('mockup-record-dot');
  const videoStatus = statusLine();
  videoPane.append(
    field('Format', videoFormat.element).row,
    field('Resolution', resolution.element).row,
    field('Frame rate', frameRate.element).row,
    recordTip,
    recordButton,
    videoStatus,
  );

  root.append(tabs.element, previewSection, imagePane, videoPane);
  return {
    tabs,
    imagePane,
    videoPane,
    preview,
    previewImage,
    previewName,
    changePose,
    poses,
    noImage,
    background,
    color,
    imageFormat,
    size,
    sizeHint: sizeField.hint,
    exportButton,
    imageStatus,
    videoFormat,
    resolution,
    frameRate,
    recordButton,
    videoStatus,
  };
}

function waitForCanvas(host: HTMLElement): Promise<HTMLCanvasElement> {
  const existing = host.querySelector('canvas');
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const canvas = host.querySelector('canvas');
      if (!canvas) return;
      observer.disconnect();
      resolve(canvas);
    });
    observer.observe(host, { childList: true });
  });
}

function flash(status: HTMLSpanElement, message: string, holdMs = 2500): void {
  status.classList.remove('is-busy');
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, holdMs);
}

function setToolbarRecording(button: HTMLButtonElement, recording: boolean): void {
  button.classList.toggle('is-recording', recording);
  button.title = recording ? 'Stop recording' : '';
  const label = button.querySelector('span');
  if (label && !recording) label.textContent = 'Export';
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function init(): Promise<void> {
  const stage = document.getElementById('stage');
  const exportRoot = document.getElementById('mockup-export');
  const foundToolbarButton = document.getElementById('open-export') as HTMLButtonElement | null;
  if (!stage || !exportRoot || !foundToolbarButton) return;
  // Explicitly typed so the narrowing survives into the nested function declarations below.
  const toolbarExportButton: HTMLButtonElement = foundToolbarButton;

  const exportModal = createModal('export-modal');
  const canvas = await waitForCanvas(stage);
  const panel = buildExportPanel(exportRoot);
  const recorder = new MockupRecorder();
  let bridge: MockupBridge | null = null;
  let exportBusy = false;
  let recordingTimer: number | null = null;
  let recordingStartedAt = 0;
  let previewToken = 0;
  // Crop size of the last 1× preview, so the Size hint can show the resulting pixel dimensions.
  let baseSize: { width: number; height: number } | null = null;

  whenBridgeReady().then((ready) => {
    bridge = ready;
    initUploads(ready);
    buildPoseChips(ready);
    if (exportModal?.isOpen()) refreshPreview();
  });

  // An upload made while the modal is up (via its "Upload now" link) should show in the preview.
  window.addEventListener('iphoneduo:image', () => {
    if (exportModal?.isOpen()) refreshPreview();
  });

  // Tabs
  panel.tabs.onChange((tab) => {
    panel.imagePane.hidden = tab !== 'image';
    panel.videoPane.hidden = tab !== 'video';
  });

  // Change pose: a row of chips that jumps the phone (and the rail) to another pose without leaving.
  function buildPoseChips(ready: MockupBridge): void {
    panel.poses.replaceChildren();
    for (const target of ready.targets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mockup-pose-chip';
      chip.dataset.id = target.id;
      chip.textContent = target.label;
      chip.addEventListener('click', () => {
        ready.select(target.id);
        setPosesOpen(false);
        refreshPreview();
      });
      panel.poses.append(chip);
    }
  }
  function setPosesOpen(open: boolean): void {
    panel.poses.hidden = !open;
    panel.changePose.setAttribute('aria-expanded', String(open));
    panel.changePose.textContent = open ? 'Cancel' : 'Change pose';
  }
  panel.changePose.addEventListener('click', () => setPosesOpen(panel.poses.hidden));

  function currentBackground(forceOpaque: boolean): Background {
    if (panel.background.value === 'transparent' && !forceOpaque) return { transparent: true };
    return { transparent: false, color: panel.color.value };
  }

  function syncSizeHint(): void {
    const scale = Number(panel.size.value);
    if (!baseSize) {
      panel.sizeHint.hidden = true;
      return;
    }
    panel.sizeHint.textContent = `${Math.round(baseSize.width * scale)} × ${Math.round(baseSize.height * scale)} px`;
    panel.sizeHint.hidden = false;
    // 3× of a large retina canvas can exceed what the GPU will allocate; grey it out rather than fail.
    const pixels3 = canvas.width * canvas.height * 9;
    panel.size.setDisabled('3', pixels3 > MAX_STILL_PIXELS, 'Too large for this screen size — try 2×.');
    if (pixels3 > MAX_STILL_PIXELS && panel.size.value === '3') panel.size.setValue('2');
  }

  function syncImageControls(): void {
    const isJpeg = panel.imageFormat.value === 'jpeg';
    panel.background.setDisabled('transparent', isJpeg, 'JPEG has no transparency.');
    if (isJpeg && panel.background.value === 'transparent') panel.background.setValue('solid');
    panel.color.disabled = panel.background.value === 'transparent';
    const span = panel.exportButton.querySelector('span');
    if (span) span.textContent = `Export as ${panel.imageFormat.value.toUpperCase()}`;
    syncSizeHint();
  }

  // Re-captures the thumbnail of what an export would produce right now. While the phone is still
  // settling into a pose the capture is deferred — a mid-animation frame would be wrong. The token
  // drops stale attempts if settings change again before a deferred one runs.
  function refreshPreview(): void {
    const current = bridge?.current();
    panel.previewName.textContent = current?.label ?? '';
    for (const chip of panel.poses.querySelectorAll<HTMLButtonElement>('.mockup-pose-chip')) {
      chip.classList.toggle('is-active', chip.dataset.id === current?.id);
    }
    const missing = !!bridge && !!current && !bridge.hasImage(current.id);
    panel.noImage.replaceChildren();
    if (missing && current) {
      const uploadNow = document.createElement('button');
      uploadNow.type = 'button';
      uploadNow.className = 'mockup-notice-link';
      uploadNow.textContent = 'Upload now';
      // Takes the user to that pose's own upload box in the rail: close the modal, open the card, and
      // briefly highlight the dropzone so it's obvious where to drop the file.
      uploadNow.addEventListener('click', () => {
        exportModal?.close();
        bridge?.select(current.id);
        window.setTimeout(() => {
          const dropzone = document.querySelector<HTMLButtonElement>(
            `.highlight-slot[data-upload-slot="${current.id}"] .upload-dropzone`,
          );
          if (!dropzone) return;
          dropzone.focus({ preventScroll: true });
          dropzone.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          dropzone.classList.add('is-attention');
          window.setTimeout(() => dropzone.classList.remove('is-attention'), 1600);
        }, 350);
      });
      const text = document.createElement('span');
      text.append(`No screenshot uploaded for ${current.label} — it will export with the default screen. `, uploadNow);
      panel.noImage.append(text);
    }
    panel.noImage.hidden = !missing;
    const background = currentBackground(false);
    panel.preview.style.background = background.transparent ? '' : background.color;
    panel.preview.classList.toggle('is-transparent', background.transparent);
    const token = ++previewToken;
    panel.preview.classList.add('is-loading');
    const attempt = (): void => {
      if (token !== previewToken || !exportModal?.isOpen()) return;
      if (!bridge || bridge.isSettling()) {
        window.setTimeout(attempt, 200);
        return;
      }
      try {
        const still = composeStill(bridge.renderStill(1), canvas, background);
        baseSize = { width: still.width, height: still.height };
        panel.previewImage.src = still.toDataURL('image/png');
        panel.preview.classList.remove('is-loading');
        syncSizeHint();
      } catch (error) {
        console.error(error);
      }
    };
    attempt();
  }

  toolbarExportButton.addEventListener('click', () => {
    if (recorder.active) {
      stopRecording();
      return;
    }
    setPosesOpen(false);
    exportModal?.open();
    refreshPreview();
  });

  for (const format of ['webm', 'mp4'] as const) {
    if (!videoFormatSupported(format)) {
      panel.videoFormat.setDisabled(format, true, `${format.toUpperCase()} recording isn't supported in this browser.`);
    }
  }

  function onImageSettingChange(): void {
    syncImageControls();
    if (exportModal?.isOpen()) refreshPreview();
  }
  panel.background.onChange(onImageSettingChange);
  panel.imageFormat.onChange(onImageSettingChange);
  panel.color.addEventListener('input', onImageSettingChange);
  panel.size.onChange(syncSizeHint);
  syncImageControls();

  panel.exportButton.addEventListener('click', () => {
    if (exportBusy || !bridge) return;
    exportBusy = true;
    panel.exportButton.disabled = true;
    panel.imageStatus.textContent = 'Exporting…';
    panel.imageStatus.classList.add('is-busy');
    const format = panel.imageFormat.value as ImageFormat;
    const background = currentBackground(false);
    // JPEG has no alpha channel; fall back to white rather than let transparent areas turn black.
    const effective = format === 'jpeg' && background.transparent ? ({ transparent: false, color: '#ffffff' } as const) : background;
    const slug = bridge.current().id;
    const scale = Number(panel.size.value);
    // Let the busy state paint before the (synchronous) high-res render blocks the thread.
    window.setTimeout(() => {
      Promise.resolve()
        .then(() => composeStill(bridge!.renderStill(scale), canvas, effective))
        .then((still) => exportStill(still, format, slug))
        .then(() => flash(panel.imageStatus, 'Saved.'))
        .catch((error: unknown) => {
          console.error(error);
          flash(panel.imageStatus, 'Export failed.');
        })
        .finally(() => {
          exportBusy = false;
          panel.exportButton.disabled = false;
        });
    }, 30);
  });

  function stopRecording(): void {
    if (recordingTimer !== null) {
      window.clearInterval(recordingTimer);
      recordingTimer = null;
    }
    toolbarExportButton.disabled = true;
    panel.videoStatus.textContent = 'Saving video…';
    recorder.stop().then(() => {
      toolbarExportButton.disabled = false;
      setToolbarRecording(toolbarExportButton, false);
      panel.recordButton.disabled = false;
      panel.recordButton.classList.remove('is-recording');
      const label = panel.recordButton.querySelector('span');
      if (label) label.textContent = 'Create Video';
      flash(panel.videoStatus, 'Saved.');
    });
  }

  panel.recordButton.addEventListener('click', () => {
    if (recorder.active) {
      stopRecording();
      return;
    }
    const format = panel.videoFormat.value as VideoFormat;
    const height = panel.resolution.value === 'source' ? undefined : Number(panel.resolution.value);
    const fps = Number(panel.frameRate.value);
    panel.recordButton.disabled = true;
    panel.videoStatus.textContent = 'Starting…';
    panel.videoStatus.classList.add('is-busy');
    recorder
      .start(canvas, format, currentBackground(true), { fps, height })
      .then(() => {
        const label = panel.recordButton.querySelector('span');
        if (label) label.textContent = 'Stop';
        panel.recordButton.classList.add('is-recording');
        panel.recordButton.disabled = false;
        panel.videoStatus.classList.remove('is-busy');
        panel.videoStatus.textContent = '';
        setToolbarRecording(toolbarExportButton, true);
        // The toolbar button is the only visible surface once the modal closes below, so the running
        // duration lives there rather than in the (now-hidden) status line.
        recordingStartedAt = Date.now();
        const toolbarLabel = toolbarExportButton.querySelector('span');
        if (toolbarLabel) toolbarLabel.textContent = '0:00';
        recordingTimer = window.setInterval(() => {
          const current = toolbarExportButton.querySelector('span');
          if (current) current.textContent = formatElapsed(Date.now() - recordingStartedAt);
        }, 500);
        // Close so the phone stays interactive (rotate/pose) while the recording is running.
        exportModal?.close();
      })
      .catch((error: unknown) => {
        console.error(error);
        panel.recordButton.disabled = false;
        flash(panel.videoStatus, 'Recording is not supported here.');
      });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
