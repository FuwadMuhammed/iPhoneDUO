// Builds one upload row per highlight (see MockupBridge in experience.ts) into #upload-list, each with
// its own file picker, thumbnail preview, exact dimension hint + copy button, and remove action. Waits
// for the 'iphoneduo:bridge' window event since experience.ts loads and boots asynchronously in its own
// chunk, well after this module's top-level code runs.
import { highlightImageSize, paintHighlightImage } from '../device/screens';
import type { MockupBridge } from '../experience';

const UPLOAD_ICON =
  '<rect x="3" y="6" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 16V9M8.5 12.5 12 9l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
const COPY_ICON =
  '<rect x="8.5" y="8.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/>';
const CHECK_ICON = '<path d="M5 12.5 9.5 17 19 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';

function buildRow(bridge: MockupBridge, target: MockupBridge['targets'][number]): HTMLElement {
  const size = highlightImageSize(target.panel, target.turn);

  const row = document.createElement('div');
  row.className = 'upload-row';

  const thumb = document.createElement('div');
  thumb.className = 'upload-thumb';
  thumb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${UPLOAD_ICON}</svg>`;

  const info = document.createElement('div');
  info.className = 'upload-info';
  const title = document.createElement('span');
  title.className = 'upload-info-title';
  title.textContent = target.label;
  const dimension = document.createElement('span');
  dimension.className = 'dimension-tag';
  const dimensionText = document.createElement('span');
  dimensionText.textContent = `${size.width} × ${size.height} px`;
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'copy-button';
  copyButton.setAttribute('aria-label', 'Copy dimensions');
  copyButton.title = 'Copy dimensions';
  copyButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COPY_ICON}</svg>`;
  dimension.append(dimensionText, copyButton);
  info.append(title, dimension);

  const actions = document.createElement('div');
  actions.className = 'upload-actions';
  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.className = 'upload-action-button';
  uploadButton.textContent = 'Upload';
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'upload-remove-button';
  removeButton.textContent = 'Remove';
  removeButton.hidden = true;
  actions.append(uploadButton, removeButton);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;

  row.append(thumb, info, actions, input);

  function setThumbnail(image: HTMLCanvasElement | null): void {
    if (!image) {
      thumb.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${UPLOAD_ICON}</svg>`;
      thumb.classList.remove('has-image');
      uploadButton.textContent = 'Upload';
      removeButton.hidden = true;
      return;
    }
    thumb.innerHTML = '';
    const preview = document.createElement('img');
    preview.src = image.toDataURL('image/png');
    preview.alt = '';
    thumb.append(preview);
    thumb.classList.add('has-image');
    uploadButton.textContent = 'Replace';
    removeButton.hidden = false;
  }

  copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(`${size.width} × ${size.height}`).then(() => {
      copyButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${CHECK_ICON}</svg>`;
      copyButton.classList.add('is-copied');
      setTimeout(() => {
        copyButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COPY_ICON}</svg>`;
        copyButton.classList.remove('is-copied');
      }, 1200);
    }, console.error);
  });

  uploadButton.addEventListener('click', () => input.click());
  thumb.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    paintHighlightImage(file, target.panel, target.turn).then(
      (image) => {
        setThumbnail(image);
        bridge.setImage(target.id, image);
        bridge.select(target.id);
      },
      (error: unknown) => console.error(error),
    );
  });

  removeButton.addEventListener('click', () => {
    setThumbnail(null);
    bridge.setImage(target.id, null);
  });

  return row;
}

export function initUploads(bridge: MockupBridge): void {
  const list = document.getElementById('upload-list');
  const resetAll = document.getElementById('reset-all-uploads');
  if (!list) return;
  const rows: { readonly button: HTMLButtonElement }[] = [];
  for (const target of bridge.targets) {
    const row = buildRow(bridge, target);
    list.append(row);
    const removeButton = row.querySelector<HTMLButtonElement>('.upload-remove-button');
    if (removeButton) rows.push({ button: removeButton });
  }
  resetAll?.addEventListener('click', () => {
    for (const { button } of rows) if (!button.hidden) button.click();
  });
}

export function whenBridgeReady(): Promise<MockupBridge> {
  return new Promise((resolve) => {
    window.addEventListener('iphoneduo:bridge', (event) => resolve(event.detail), { once: true });
  });
}
