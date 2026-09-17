// Generic open/close plumbing for overlay modals declared in index.html (currently just #export-modal):
// backdrop click, [data-close-modal] buttons, and Escape all close whichever is open.
// Also owns focus management: moves focus in on open, traps Tab/Shift+Tab inside while open, and
// restores focus to whatever triggered the modal on close.
export interface Modal {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createModal(modalId: string): Modal | null {
  const found = document.getElementById(modalId);
  if (!found) return null;
  const modal: HTMLElement = found;
  let previouslyFocused: HTMLElement | null = null;
  function focusable(): HTMLElement[] {
    return Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE));
  }
  function open(): void {
    previouslyFocused = document.activeElement as HTMLElement | null;
    modal.hidden = false;
    // Force layout before adding the class so the entrance transition actually plays.
    void modal.offsetHeight;
    modal.classList.add('is-visible');
    focusable()[0]?.focus();
  }
  function close(): void {
    modal.classList.remove('is-visible');
    setTimeout(() => {
      modal.hidden = true;
    }, 220);
    previouslyFocused?.focus();
    previouslyFocused = null;
  }
  modal.querySelectorAll<HTMLElement>('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', close);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || modal.hidden) return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
  return { open, close, isOpen: () => !modal.hidden };
}
