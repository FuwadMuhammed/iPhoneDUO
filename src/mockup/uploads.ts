// Builds one upload box per highlight (see MockupBridge in experience.ts) and mounts it inside that
// highlight's expandable rail card (the `.highlight-slot` rail.ts leaves for it), each with its own
// dropzone, thumbnail preview, exact dimension hint + copy button, and remove action. Waits for the
// 'iphoneduo:bridge' window event since experience.ts loads and boots asynchronously in its own chunk,
// well after this module's top-level code runs.
import { highlightImageSize, paintHighlightImage } from '../device/screens';
import type { MockupBridge } from '../experience';

const UPLOAD_ICON =
  '<rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 16V9M8.5 12.5 12 9l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
const COPY_ICON =
  '<rect x="8.5" y="8.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/>';
const CHECK_ICON = '<path d="M5 12.5 9.5 17 19 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
const REPLACE_ICON =
  '<path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.5 3.5v3.3h-3.3M6.5 20.5v-3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
const TRASH_ICON =
  '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10 11v5.5M14 11v5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';

// "1600 × 1125 px" with a copy-to-clipboard button. Built twice per box (once per state) since each
// state lays it out differently.
function dimensionTag(size: { width: number; height: number }): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'dimension-tag';
  const text = document.createElement('span');
  text.textContent = `${size.width} × ${size.height} px`;
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'copy-button';
  copyButton.setAttribute('aria-label', 'Copy dimensions');
  copyButton.title = 'Copy dimensions';
  copyButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COPY_ICON}</svg>`;
  copyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    navigator.clipboard.writeText(`${size.width} × ${size.height}`).then(() => {
      copyButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CHECK_ICON}</svg>`;
      copyButton.classList.add('is-copied');
      setTimeout(() => {
        copyButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COPY_ICON}</svg>`;
        copyButton.classList.remove('is-copied');
      }, 1200);
    }, console.error);
  });
  tag.append(text, copyButton);
  return tag;
}

// One dropzone-style box per highlight. Empty: a dashed target you click or drop onto, showing the
// exact size to prepare. Filled: a solid box with the preview, size, and Replace/Remove.
function buildBox(bridge: MockupBridge, target: MockupBridge['targets'][number]): HTMLElement {
  const size = highlightImageSize(target.panel, target.turn);

  const box = document.createElement('div');
  box.className = 'upload-box';

  const dropzone = document.createElement('button');
  dropzone.type = 'button';
  dropzone.className = 'upload-dropzone';
  dropzone.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${UPLOAD_ICON}</svg>`;
  const dropTitle = document.createElement('span');
  dropTitle.className = 'upload-dropzone-title';
  dropTitle.innerHTML = '<strong>Click to upload</strong> or drag an image here';
  const dropHint = document.createElement('span');
  dropHint.className = 'upload-dropzone-hint';
  dropHint.append('Best at ', dimensionTag(size));
  dropzone.append(dropTitle, dropHint);

  // Filled state: a preview band (click to replace) over a footer with the size and actions.
  const preview = document.createElement('div');
  preview.className = 'upload-preview';
  preview.hidden = true;
  const media = document.createElement('button');
  media.type = 'button';
  media.className = 'upload-preview-media';
  media.setAttribute('aria-label', 'Replace image');
  const foot = document.createElement('div');
  foot.className = 'upload-preview-foot';
  const filename = document.createElement('span');
  filename.className = 'upload-filename';
  const actions = document.createElement('div');
  actions.className = 'upload-actions';
  const replaceButton = document.createElement('button');
  replaceButton.type = 'button';
  replaceButton.className = 'upload-icon-button';
  replaceButton.setAttribute('aria-label', 'Replace image');
  replaceButton.title = 'Replace';
  replaceButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${REPLACE_ICON}</svg>`;
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'upload-icon-button upload-icon-button--danger upload-remove-button';
  removeButton.setAttribute('aria-label', 'Remove image');
  removeButton.title = 'Remove';
  removeButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TRASH_ICON}</svg>`;
  removeButton.hidden = true;
  actions.append(replaceButton, removeButton);
  foot.append(filename, actions);
  preview.append(media, foot);

  const errorText = document.createElement('span');
  errorText.className = 'upload-error';
  errorText.setAttribute('aria-live', 'polite');
  errorText.hidden = true;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;

  box.append(dropzone, preview, errorText, input);

  function setImage(image: HTMLCanvasElement | null, name = ''): void {
    const filled = image !== null;
    box.classList.toggle('has-image', filled);
    dropzone.hidden = filled;
    preview.hidden = !filled;
    removeButton.hidden = !filled;
    media.innerHTML = '';
    filename.textContent = name;
    filename.title = name;
    if (!image) return;
    const img = document.createElement('img');
    img.src = image.toDataURL('image/png');
    img.alt = '';
    media.append(img);
  }

  function handleFile(file: File): void {
    errorText.hidden = true;
    paintHighlightImage(file, target.panel, target.turn).then(
      (image) => {
        setImage(image, file.name);
        bridge.setImage(target.id, image);
        window.dispatchEvent(new CustomEvent('iphoneduo:image', { detail: target.id }));
      },
      (error: unknown) => {
        console.error(error);
        errorText.textContent = "Couldn't use that image — try a different file.";
        errorText.hidden = false;
      },
    );
  }

  dropzone.addEventListener('click', () => input.click());
  replaceButton.addEventListener('click', () => input.click());
  media.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) handleFile(file);
  });

  box.addEventListener('dragover', (event) => {
    event.preventDefault();
    box.classList.add('is-dragover');
  });
  box.addEventListener('dragleave', () => box.classList.remove('is-dragover'));
  box.addEventListener('drop', (event) => {
    event.preventDefault();
    box.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  removeButton.addEventListener('click', () => {
    setImage(null);
    errorText.hidden = true;
    bridge.setImage(target.id, null);
    window.dispatchEvent(new CustomEvent('iphoneduo:image', { detail: target.id }));
  });

  return box;
}

export function initUploads(bridge: MockupBridge): void {
  const resetAll = document.getElementById('reset-all-uploads');
  const rows: { readonly button: HTMLButtonElement }[] = [];
  for (const target of bridge.targets) {
    const slot = document.querySelector<HTMLElement>(`.highlight-slot[data-upload-slot="${target.id}"]`);
    if (!slot) continue;
    const box = buildBox(bridge, target);
    slot.append(box);
    const removeButton = box.querySelector<HTMLButtonElement>('.upload-remove-button');
    if (removeButton) rows.push({ button: removeButton });
  }
  if (!resetAll) return;
  // Two-step inline confirm instead of window.confirm(): embedded webviews often suppress native
  // dialogs, which made the reset silently do nothing.
  const idleLabel = resetAll.textContent ?? 'Reset all images';
  let armedUntil = 0;
  let disarmTimer: number | null = null;
  function disarm(): void {
    armedUntil = 0;
    if (disarmTimer !== null) window.clearTimeout(disarmTimer);
    disarmTimer = null;
    resetAll!.classList.remove('is-armed');
    resetAll!.textContent = idleLabel;
  }
  resetAll.addEventListener('click', () => {
    const active = rows.filter(({ button }) => !button.hidden);
    if (active.length === 0) return;
    if (Date.now() < armedUntil) {
      disarm();
      for (const { button } of active) button.click();
      return;
    }
    armedUntil = Date.now() + 4000;
    resetAll.classList.add('is-armed');
    resetAll.textContent = `Click again to remove ${active.length === 1 ? 'the image' : `all ${active.length} images`}`;
    disarmTimer = window.setTimeout(disarm, 4000);
  });
}

export function whenBridgeReady(): Promise<MockupBridge> {
  return new Promise((resolve) => {
    window.addEventListener('iphoneduo:bridge', (event) => resolve(event.detail), { once: true });
  });
}
