// Small shared DOM helpers for every screen.
import { getPref, setPref } from './device.js';

// el('div.panel', { onclick }, child, 'text', ...)
export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
export function toast(message, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Bottom sheet with a title, body nodes and a close button. Returns a close function.
export function sheet(title, ...body) {
  return sheetWithClose('Got it', title, ...body);
}

// The same sheet with its own label on the close button (e.g. 'Cancel').
export function sheetWithClose(closeLabel, title, ...body) {
  const close = () => backdrop.remove();
  const backdrop = el('div.sheet-backdrop', { onclick: (e) => e.target === backdrop && close() },
    el('div.sheet', { role: 'dialog', 'aria-modal': 'true' },
      el('h2', { text: title }),
      ...body,
      el('button.btn.wide', { type: 'button', onclick: close }, closeLabel)));
  document.body.append(backdrop);
  return close;
}

export function formatAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

// A fold-away section: a one-line summary the player taps to open or close the body. Starts closed;
// whether it is open is remembered per device under `fold.<key>`, so re-renders keep it.
export function fold(key, summary, ...body) {
  const pref = `fold.${key}`;
  const node = el('details.fold', { open: !!getPref(pref, false) },
    el('summary', {}, summary),
    el('div.fold-body', {}, ...body));
  node.addEventListener('toggle', () => setPref(pref, node.open));
  return node;
}
