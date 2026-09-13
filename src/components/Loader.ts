import { requireElement } from '../dom';
export class Loader {
  private element: HTMLElement;
  private label: HTMLElement;
  private bar: HTMLElement;
  private shown = 0;
  constructor(selector: string) {
    this.element = requireElement(selector);
    this.label = requireElement('.loader-label', this.element);
    this.bar = requireElement('.loader-bar', this.element);
  }
  setProgress(fraction: number, message?: string) {
    this.shown = Math.max(this.shown, Math.min(Math.max(fraction, 0), 1));
    const percent = Math.round(this.shown * 100);
    this.bar.style.transform = `scaleX(${this.shown})`;
    this.element.setAttribute('aria-valuenow', String(percent));
    if (message) this.label.textContent = `${message} ${percent}%`;
  }
  done() {
    this.setProgress(1);
    this.element.closest('.viewer')?.classList.add('is-ready');
    this.element.setAttribute('aria-busy', 'false');
  }
  fail(message: string) {
    this.element.classList.add('is-failed');
    this.label.textContent = message;
  }
}
