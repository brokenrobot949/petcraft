// A bottom sheet that redraws only when a key of the numbers it shows changes (the same look as the
// building sheets on Home). One sheet from this helper is open at a time.
import { el } from './dom.js';

let current = null; // { backdrop, unsub }

export function closeSheet() {
  if (!current) return;
  current.unsub?.();
  current.backdrop.remove();
  current = null;
}

// buildBody(body, foot) fills the scroll area and the pinned footer; it runs again only when keyFn()
// returns a different value. Returns a close function.
export function openSheet(game, title, buildBody, keyFn) {
  closeSheet();
  const body = el('div.hs-body');
  const foot = el('div.hs-foot');
  const backdrop = el('div.sheet-backdrop.home-sheet-backdrop', { onclick: (e) => e.target === backdrop && closeSheet() },
    el('div.sheet.home-sheet', { role: 'dialog', 'aria-modal': 'true' }, el('h2', { text: title }), body, foot));
  document.body.append(backdrop);
  let lastKey = null;
  const render = () => {
    const key = keyFn();
    if (key === lastKey) return;
    lastKey = key;
    const scroll = body.scrollTop;
    body.replaceChildren();
    foot.replaceChildren();
    buildBody(body, foot);
    foot.append(el('button.btn.wide', { type: 'button', onclick: closeSheet }, 'Close'));
    body.scrollTop = scroll;
  };
  const mine = { backdrop, unsub: game.subscribe(render) };
  current = mine;
  render();
  return closeSheet;
}
