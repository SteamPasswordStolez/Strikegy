/** A key event typed into a text box (chat, names): the game's keys leave those alone. */
export function typing(e: Event): boolean {
  const x = e.target as HTMLElement | null;
  return !!x && (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA' || x.isContentEditable);
}
