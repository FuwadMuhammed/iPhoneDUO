import { requireElement } from '../dom';
export class Uploader {
  private button: HTMLButtonElement;
  private field: HTMLInputElement;
  private reset: HTMLButtonElement;
  constructor(buttonSelector: string, fieldSelector: string, resetSelector: string) {
    this.button = requireElement(buttonSelector);
    this.field = requireElement(fieldSelector);
    this.reset = requireElement(resetSelector);
  }
  setDisabled(disabled: boolean) {
    this.button.disabled = disabled;
  }
  setCustom(custom: boolean) {
    this.reset.hidden = !custom;
  }
  onReset(callback: () => void) {
    this.reset.addEventListener('click', () => {
      this.setCustom(false);
      callback();
    });
  }
  onChange(callback: (file: File) => void) {
    this.button.addEventListener('click', () => this.field.click());
    this.field.addEventListener('change', () => {
      const file = this.field.files?.[0];
      this.field.value = '';
      if (file) callback(file);
    });
  }
}
