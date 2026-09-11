export class Notice {
  private element: HTMLElement;
  constructor(selector: string) {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Missing element "${selector}".`);
    this.element = found;
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
