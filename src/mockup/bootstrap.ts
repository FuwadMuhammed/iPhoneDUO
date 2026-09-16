// Wires the toolbar (#open-upload / #open-export), the two modals they open, and renders the export
// controls into the export modal's body. The fold rig in src/device and src/stage, and the upload wiring
// already owned by main.ts/experience.ts, are untouched — this only adds UI around them.
import './panel.css';
import { createModal } from './modals';
import {
  type Background,
  type ImageFormat,
  MockupRecorder,
  snapshotCanvas,
  type VideoFormat,
  videoFormatSupported,
} from './capture';
import { initUploads, whenBridgeReady } from './uploads';

const DEFAULT_COLOR = '#f9fafb'; // matches the viewer's --stage-backdrop, so Solid exports read the same as the on-screen border
const CAMERA_ICON =
  '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/>';
const RECORD_ICON = '<circle cx="12" cy="12" r="6"/>';

interface Segmented {
  readonly element: HTMLElement;
  readonly value: string;
  setValue(value: string): void;
  setDisabled(value: string, disabled: boolean): void;
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
    setDisabled(value, disabled) {
      const button = buttons.find((entry) => entry.dataset.value === value);
      if (button) button.disabled = disabled;
    },
    onChange(handler) {
      changed = handler;
    },
  };
}

interface ExportPanel {
  readonly background: Segmented;
  readonly color: HTMLInputElement;
  readonly imageFormat: Segmented;
  readonly snapshotButton: HTMLButtonElement;
  readonly videoFormat: Segmented;
  readonly recordButton: HTMLButtonElement;
  readonly status: HTMLSpanElement;
}

function section(labelText: string): { section: HTMLDivElement; row: HTMLDivElement } {
  const div = document.createElement('div');
  div.className = 'mockup-export-section';
  const label = document.createElement('span');
  label.className = 'mockup-export-label';
  label.textContent = labelText;
  const row = document.createElement('div');
  row.className = 'mockup-row';
  div.append(label, row);
  return { section: div, row };
}

function iconButton(className: string, icon: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span>`;
  return button;
}

function buildExportPanel(root: HTMLElement): ExportPanel {
  const background = createSegmented(['transparent', 'solid'], ['Transparent', 'Solid'], 'transparent');
  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'mockup-swatch';
  color.value = DEFAULT_COLOR;
  color.disabled = true;
  color.setAttribute('aria-label', 'Background colour');
  const bg = section('Background');
  bg.row.append(background.element, color);

  const imageFormat = createSegmented(['png', 'jpeg'], ['PNG', 'JPEG'], 'png');
  const snapshotButton = iconButton('mockup-primary', CAMERA_ICON, 'Export Image');
  const image = section('Image');
  image.row.append(imageFormat.element);
  image.section.append(snapshotButton);

  const videoFormat = createSegmented(['webm', 'mp4'], ['WebM', 'MP4'], 'webm');
  const recordButton = iconButton('mockup-primary mockup-primary--record', RECORD_ICON, 'Record Animation');
  recordButton.querySelector('svg')?.classList.add('mockup-record-dot');
  const recordTip = document.createElement('p');
  recordTip.className = 'mockup-tip';
  recordTip.textContent = 'Hit record, move the iPhone Duo how you want, then hit stop.';
  const video = section('Video');
  video.row.append(videoFormat.element);
  video.section.append(recordButton, recordTip);

  const status = document.createElement('span');
  status.className = 'mockup-status';
  status.setAttribute('aria-live', 'polite');
  video.section.append(status);

  root.append(bg.section, image.section, video.section);
  return { background, color, imageFormat, snapshotButton, videoFormat, recordButton, status };
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
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) status.textContent = '';
  }, holdMs);
}

function setToolbarRecording(button: HTMLButtonElement, recording: boolean): void {
  button.classList.toggle('is-recording', recording);
  const label = button.querySelector('span');
  if (label) label.textContent = recording ? 'Stop' : 'Export';
}

async function init(): Promise<void> {
  const stage = document.getElementById('stage');
  const exportRoot = document.getElementById('mockup-export');
  const toolbarExportButton = document.getElementById('open-export') as HTMLButtonElement | null;
  const toolbarUploadButton = document.getElementById('open-upload');
  if (!stage || !exportRoot || !toolbarExportButton || !toolbarUploadButton) return;

  const uploadModal = createModal('upload-modal');
  const exportModal = createModal('export-modal');
  toolbarUploadButton.addEventListener('click', () => uploadModal?.open());
  whenBridgeReady().then((bridge) => initUploads(bridge));

  const canvas = await waitForCanvas(stage);
  const panel = buildExportPanel(exportRoot);
  const recorder = new MockupRecorder();
  let snapshotBusy = false;

  toolbarExportButton.addEventListener('click', () => {
    if (recorder.active) {
      toolbarExportButton.disabled = true;
      panel.status.textContent = 'Saving video…';
      recorder.stop().then(() => {
        toolbarExportButton.disabled = false;
        setToolbarRecording(toolbarExportButton, false);
        panel.recordButton.disabled = false;
        panel.recordButton.classList.remove('is-recording');
        const label = panel.recordButton.querySelector('span');
        if (label) label.textContent = 'Record Animation';
        flash(panel.status, 'Saved.');
      });
      return;
    }
    exportModal?.open();
  });

  for (const format of ['webm', 'mp4'] as const) {
    if (!videoFormatSupported(format)) panel.videoFormat.setDisabled(format, true);
  }

  function syncBackgroundControls(): void {
    const isJpeg = panel.imageFormat.value === 'jpeg';
    panel.background.setDisabled('transparent', isJpeg);
    if (isJpeg && panel.background.value === 'transparent') panel.background.setValue('solid');
    panel.color.disabled = panel.background.value === 'transparent';
  }
  panel.background.onChange(() => syncBackgroundControls());
  panel.imageFormat.onChange(() => syncBackgroundControls());
  syncBackgroundControls();

  function currentBackground(forceOpaque: boolean): Background {
    if (panel.background.value === 'transparent' && !forceOpaque) return { transparent: true };
    return { transparent: false, color: panel.color.value };
  }

  panel.snapshotButton.addEventListener('click', () => {
    if (snapshotBusy) return;
    snapshotBusy = true;
    panel.snapshotButton.disabled = true;
    panel.status.textContent = 'Exporting…';
    const format = panel.imageFormat.value as ImageFormat;
    snapshotCanvas(canvas, format, currentBackground(false))
      .then(() => flash(panel.status, 'Saved.'))
      .catch((error: unknown) => {
        console.error(error);
        flash(panel.status, 'Export failed.');
      })
      .finally(() => {
        snapshotBusy = false;
        panel.snapshotButton.disabled = false;
      });
  });

  panel.recordButton.addEventListener('click', () => {
    if (recorder.active) {
      toolbarExportButton.click();
      return;
    }
    const format = panel.videoFormat.value as VideoFormat;
    panel.recordButton.disabled = true;
    panel.status.textContent = 'Starting…';
    recorder
      .start(canvas, format, currentBackground(true))
      .then(() => {
        const label = panel.recordButton.querySelector('span');
        if (label) label.textContent = 'Stop';
        panel.recordButton.classList.add('is-recording');
        panel.recordButton.disabled = false;
        setToolbarRecording(toolbarExportButton, true);
        // Close so the phone stays interactive (rotate/pose) while the recording is running.
        exportModal?.close();
      })
      .catch((error: unknown) => {
        console.error(error);
        panel.recordButton.disabled = false;
        flash(panel.status, 'Recording is not supported here.');
      });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
