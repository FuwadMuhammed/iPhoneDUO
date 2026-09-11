export class Uploader {
  private button: HTMLButtonElement;
  private field: HTMLInputElement;
  private reset: HTMLButtonElement;
  constructor(buttonSelector: string, fieldSelector: string, resetSelector: string) {
    const btn = document.querySelector<HTMLButtonElement>(buttonSelector);
    const fld = document.querySelector<HTMLInputElement>(fieldSelector);
    const rst = document.querySelector<HTMLButtonElement>(resetSelector);
    if (!btn || !fld || !rst) throw new Error(`Missing upload elements`);
    this.button = btn;
    this.field = fld;
    this.reset = rst;
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
