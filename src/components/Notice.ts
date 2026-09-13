import { requireElement } from '../dom';
export class Notice {
  private element: HTMLElement;
  constructor(selector: string) {
    this.element = requireElement(selector);
  }
  show(message: string, seconds?: number) {
    this.element.textContent = message;
    this.element.hidden = false;
    if (seconds) {
      window.setTimeout(() => {
        this.element.hidden = true;
      }, seconds * 1000);
    }
  }
}
