/** Full-screen message layer used for start / pause / error states. */
export class Overlay {
  readonly root: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private hintEl: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'overlay-title';
    this.subEl = document.createElement('div');
    this.subEl.className = 'overlay-sub';
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'overlay-hint';
    this.root.append(this.titleEl, this.subEl, this.hintEl);
    parent.appendChild(this.root);
  }

  /** Extra content between the subtitle and the hint (e.g. the final scoreboard); null removes it. */
  setExtra(el: HTMLElement | null): void {
    this.root.querySelector('.overlay-extra')?.remove();
    if (!el) return;
    const box = document.createElement('div');
    box.className = 'overlay-extra';
    box.appendChild(el);
    this.root.insertBefore(box, this.hintEl);
  }

  show(title: string, sub = '', hint = ''): void {
    this.titleEl.textContent = title;
    this.subEl.textContent = sub;
    this.hintEl.textContent = hint;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
