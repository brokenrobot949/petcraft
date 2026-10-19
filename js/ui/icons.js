// Item icons for DOM screens, cut from the packed sprite atlas with CSS (no canvas needed).
// An item's icon is the atlas frame "item.<itemId>/idle/0" (role item.<itemId> in sprites.json).
// Call loadIcons() once at boot; itemIcon() then returns ready-to-use elements. Items without a
// cast icon get a lettered placeholder tile.
import { el } from './dom.js';

let atlas = null; // { url, w, h, frames }

export async function loadIcons(spritesData) {
  try {
    const jsonUrl = new URL(spritesData.atlas, location.href);
    const res = await fetch(jsonUrl);
    if (!res.ok) return;
    const json = await res.json();
    atlas = {
      url: new URL(json.meta.image, jsonUrl).href,
      w: json.meta.size.w,
      h: json.meta.size.h,
      frames: json.frames,
    };
  } catch {
    atlas = null;
  }
}

// A square element showing the item's 16x16 icon at `px` CSS pixels (use multiples of 16).
export function itemIcon(itemId, px = 32, label = '') {
  const f = atlas?.frames[`item.${itemId}/idle/0`]?.frame;
  if (!f) {
    return el('span.item-icon.placeholder', { 'aria-hidden': 'true', style: `width:${px}px;height:${px}px;font-size:${Math.round(px / 2)}px` },
      (label || itemId).charAt(0).toUpperCase());
  }
  const k = px / f.w;
  return el('span.item-icon.px', {
    'aria-hidden': 'true',
    style: [
      `width:${px}px`, `height:${Math.round(f.h * k)}px`,
      `background-image:url("${atlas.url}")`,
      `background-size:${atlas.w * k}px ${atlas.h * k}px`,
      `background-position:${-f.x * k}px ${-f.y * k}px`,
    ].join(';'),
  });
}
