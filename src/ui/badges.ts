import { item } from '@/progression/catalog';
import type { Badge } from '@/net/lobbyProtocol';
import { emblemSvg } from './cosmetics';
import { insigniaAt, rankLabel } from './rankInsignia';
import './progress.css';
import './badges.css';

/**
 * A signed-in person's badge beside their name in multiplayer (owner,
 * 2026-10-25): the emblem and rank insignia before the name, the name in the
 * plate's colour. The server reads it from their account; a hidden level
 * leaves the insignia out.
 */

/** The plate's colour as `#rrggbb`, if they put one on. */
export function plateColour(b: Badge | undefined): string | null {
  const plate = b?.plate ? item(b.plate)?.plate : undefined;
  return plate === undefined ? null : `#${plate.toString(16).padStart(6, '0')}`;
}

/** Emblem + insignia as HTML (ids from the catalog, so nothing a player typed). */
export function badgeHtml(b: Badge | undefined, size = 16): string {
  if (!b) return '';
  const emb = b.emblem ? item(b.emblem)?.emblem : undefined;
  const parts = [emb ? emblemSvg(emb, size) : '', b.lv ? `<span class="bdg-rank" title="${rankLabel(b.lv)}">${insigniaAt(b.lv)}</span>` : ''];
  const html = parts.join('');
  return html ? `<span class="bdg" style="--bdg:${size}px">${html}</span>` : '';
}

/** `style` for a name in its plate's colour (empty without a plate). */
export function plateStyle(b: Badge | undefined): string {
  const c = plateColour(b);
  return c ? ` style="--plate:${c}"` : '';
}

const emblemImages = new Map<string, HTMLImageElement>();

/**
 * An emblem as an image for a canvas (name tags): null until it has loaded,
 * then `onLoad` is called once so the tag can be drawn again.
 */
export function emblemImage(id: string, onLoad: () => void): HTMLImageElement | null {
  let img = emblemImages.get(id);
  if (!img) {
    const look = item(id)?.emblem;
    if (!look) return null;
    img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(emblemSvg(look, 64).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`;
    emblemImages.set(id, img);
  }
  if (img.complete && img.naturalWidth) return img;
  img.addEventListener('load', onLoad, { once: true });
  return null;
}
