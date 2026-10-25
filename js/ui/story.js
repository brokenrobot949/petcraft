// Story screens (Phase 9): the full-screen scene that plays when a Grand Project is finished,
// and the story journal panel on the Journal tab.
import { el, toast } from './dom.js';
import { openSheet } from './layer.js';
import { storyList, sceneFor } from '../systems/story.js';

const LINE_MS = 2600; // time before the next line appears on its own
let playing = false;
export const scenePlaying = () => playing;

// ---- the scene ----

export function playScene(app, projectId, homeScene) {
  if (playing) return;
  const { game } = app;
  const sc = sceneFor(game.data, projectId);
  const done = () => {
    try {
      game.dispatch('sanctuary/sceneSeen', { project: projectId });
    } catch (err) {
      console.error(err);
    }
  };
  if (!sc) {
    done();
    return;
  }
  playing = true;
  const projects = game.data.projects?.projects || [];
  const ending = projects.length > 0 && projects[projects.length - 1].id === projectId;
  try {
    const p = homeScene?.playProjectScene?.(projectId, { ending });
    p?.catch?.((err) => console.error(err));
  } catch (err) {
    console.error(err);
  }

  const lines = el('div.scene-lines', { 'aria-live': 'polite' });
  const actions = el('div.scene-actions');
  const skip = el('button.btn.scene-skip', { type: 'button', onclick: () => finish() }, 'Skip');
  const overlay = el('div.scene-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': sc.title },
    skip, el('h2.scene-title', {}, sc.title), lines, actions);
  let i = 0;
  let timer = 0;
  let closed = false;

  function finish() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    overlay.remove();
    playing = false;
    done();
  }
  function next() {
    clearTimeout(timer);
    if (closed) return;
    if (i < sc.lines.length) {
      const p = el('p.scene-line', {}, sc.lines[i++]);
      lines.append(p);
      requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('in')));
      timer = setTimeout(next, LINE_MS);
    } else {
      skip.hidden = true;
      actions.append(el('button.btn.wide', { type: 'button', onclick: finish }, 'Continue'));
    }
  }
  // Tap anywhere to show the next line sooner.
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (i < sc.lines.length || !actions.firstChild) next();
  });
  document.body.append(overlay);
  next();
}

// ---- the story journal ----

function openEntry(app, entry) {
  const { game } = app;
  try {
    if (!entry.seen) game.dispatch('story/seen', { entry: entry.id });
  } catch (err) {
    toast(err.message);
  }
  openSheet(game, entry.title, (body) => {
    for (const para of entry.text || []) body.append(el('p', {}, para));
  }, () => entry.id);
}

// Returns { node, update(state) }. update() rebuilds only when the entries or their read marks change.
export function createStoryPanel(app) {
  const { game } = app;
  const host = el('div.panel.story-panel');
  let key = null;

  function update(state) {
    const list = storyList(state, game.data).reverse(); // newest first
    const k = list.map((e) => `${e.id}${e.seen ? 1 : 0}`).join(',');
    if (k === key) return;
    key = k;
    const unread = list.filter((e) => !e.seen).length;
    host.replaceChildren(
      el('h2', {}, `Story${unread ? ` (${unread} new)` : ''}`),
      list.length
        ? el('div', {}, list.map((e) => el('button.hs-row.story-row', { type: 'button', onclick: () => openEntry(app, e) },
          el('span.hs-row-main', {}, el('span.hs-row-name', {}, e.title)),
          e.seen ? null : el('span.story-dot', { 'aria-label': 'New' }))))
        : el('p.small.muted', {}, 'Your story will be written here as you play.'),
      ...(unread ? [el('button.btn.wide', {
        type: 'button',
        onclick: () => {
          try { game.dispatch('story/seen', {}); } catch (err) { toast(err.message); }
        },
      }, 'Mark all read')] : [])); // (replaceChildren would print a null as text)
  }
  return { node: host, update };
}
