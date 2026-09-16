// Generic open/close plumbing for the two overlay modals declared in index.html (#upload-modal,
// #export-modal): backdrop click, [data-close-modal] buttons, and Escape all close whichever is open.
export interface Modal {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createModal(modalId: string): Modal | null {
  const found = document.getElementById(modalId);
  if (!found) return null;
  const modal: HTMLElement = found;
  function open(): void {
    modal.hidden = false;
    // Force layout before adding the class so the entrance transition actually plays.
    void modal.offsetHeight;
    modal.classList.add('is-visible');
  }
  function close(): void {
    modal.classList.remove('is-visible');
    setTimeout(() => {
      modal.hidden = true;
    }, 220);
  }
  modal.querySelectorAll<HTMLElement>('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', close);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
  return { open, close, isOpen: () => !modal.hidden };
}
