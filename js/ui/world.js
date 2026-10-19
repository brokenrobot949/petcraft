// World tab: the zone map, and a page per zone with its scene, worker card and harvest nodes.
import { el, toast } from './dom.js';
import { getPref, setPref } from './device.js';
import { itemIcon } from './icons.js';
import { skillProgress } from '../systems/skills.js';
import { zoneUnlocked, nodeCheck, actionMs, workerTask, toolFor } from '../systems/harvest.js';

export const id = 'world';
export const label = 'World';
export const icon = 'assets/ui/tab-world.png';

let app = null;
let root = null;
let tabVisible = false;
let zoneId = null; // null = map
let scene = null;
let sceneToken = 0;
let lastKey = '';
let bar = null; // { fill, text } for the worker progress bar
let raf = 0;
let prog = { value: -1, at: 0 };

export function mount(container, a) {
  app = a;
  root = el('div.world');
  container.append(root);
  app.game.subscribe(() => {
    if (!tabVisible) return;
    refresh();
    tickBar(); // also runs at the game tick rate if animation frames are throttled
  });
  const saved = getPref('worldZone', null);
  if (saved && app.game.data.zones.zones.some((z) => z.id === saved)) zoneId = saved;
  buildPage();
}

export function show() {
  tabVisible = true;
  if (!root) return;
  lastKey = '';
  refresh();
  scene?.start?.();
  startLoop();
}

export function hide() {
  tabVisible = false;
  scene?.stop?.();
  cancelAnimationFrame(raf);
  raf = 0;
}

const data = () => app.game.data;
const state = () => app.game.getState();
const skillName = (sid) => data().skills.skills.find((s) => s.id === sid)?.name || sid;

function send(type, payload) {
  try {
    app.game.dispatch(type, payload);
  } catch (err) {
    toast(err.message);
  }
}

function destroyScene() {
  sceneToken++;
  try { scene?.destroy?.(); } catch (e) { console.error(e); }
  scene = null;
}

function openZone(id) {
  zoneId = id;
  setPref('worldZone', id);
  buildPage();
}

function closeZone() {
  zoneId = null;
  setPref('worldZone', null);
  buildPage();
}

function buildPage() {
  destroyScene();
  root.replaceChildren();
  bar = null;
  lastKey = '';
  if (zoneId) buildZonePage();
  if (!zoneId) root.append(el('h1', {}, 'World'), el('div.map-list'));
  if (tabVisible) refresh();
}

function refresh() {
  const key = keyFor();
  if (key !== lastKey) {
    lastKey = key;
    if (zoneId) renderZone();
    else renderMap();
  }
  if (zoneId) updateXpBars();
}

// skill id -> { fill, text, toolName } for the XP bars on the zone page
let xpBars = new Map();
function updateXpBars() {
  const s = state();
  for (const [sid, b] of xpBars) {
    const p = skillProgress(s, data(), sid);
    b.fill.style.width = `${p.max ? 100 : Math.min(100, (p.xp / p.next) * 100)}%`;
    b.text.textContent = `${p.max ? 'Max level' : `${Math.floor(p.xp)} / ${p.next} XP`}${b.toolName ? ` - ${b.toolName}` : ''}`;
  }
}

function keyFor() {
  const s = state();
  const t = s.workers.player.task;
  const base = `${t ? `${t.zone}/${t.skill}/${t.node}` : '-'}|${s.renown.rank}`;
  if (!zoneId) return base;
  // Levels only: XP changes every action and is updated in place (rebuilding the buttons that
  // often could swallow a tap).
  const sk = Object.entries(s.skills).map(([k, v]) => `${k}${v.level}`).join(',');
  const tools = Object.values(s.tools).map((x) => x.item + x.quality).join(',');
  return `${base}|${sk}|${tools}`;
}

// ---------- map ----------
function renderMap() {
  const list = root.querySelector('.map-list');
  if (!list) return;
  const s = state();
  const d = data();
  const task = workerTask(s, 'player');
  list.replaceChildren(...d.zones.zones.map((z) => {
    const open = zoneUnlocked(s, d, z.id);
    const nodes = Object.values(z.harvest || {}).reduce((n, a) => n + a.length, 0);
    let note = null;
    if (!open) {
      note = z.unlock?.grandProject != null ? 'Opens after the fifth Grand Project' : `Opens at Renown ${z.unlock?.renown}`;
    } else if (!nodes) {
      note = 'Nothing to do here yet';
    }
    let working = null;
    if (open && task && task.zone === z.id) {
      const node = z.harvest[task.skill]?.find((n) => n.id === task.node);
      working = `You: ${skillName(task.skill)} - ${node ? node.name : task.node}`;
    }
    return el(`button.zone-card.panel${open ? '' : '.locked'}`, {
      type: 'button',
      onclick: () => (open ? openZone(z.id) : toast(note)),
    },
      el('div.zone-head', {}, el('b', {}, z.name), el('span.tier', {}, `Tier ${z.tier}`)),
      el('p.small.muted', {}, z.blurb),
      note && el('p.small.zone-note', {}, note),
      working && el('p.small.zone-working', {}, working));
  }));
}

// ---------- zone page ----------
function buildZonePage() {
  const z = data().zones.zones.find((x) => x.id === zoneId);
  if (!z) {
    zoneId = null;
    return;
  }
  const host = el('div.zone-scene');
  root.append(
    el('div.zone-top', {},
      el('button.btn', { type: 'button', onclick: closeZone, 'aria-label': 'Back to the map' }, 'Back'),
      el('h1', {}, z.name)),
    host,
    el('div.zone-body'));
  const token = ++sceneToken;
  (async () => {
    try {
      const { createZoneScene } = await import('../render/zoneScene.js');
      const sc = await createZoneScene(host, app.game, z.id);
      if (token !== sceneToken) {
        sc?.destroy?.();
        return;
      }
      scene = sc;
      if (tabVisible) scene.start();
    } catch (err) {
      console.error(err);
      if (token === sceneToken) host.append(el('div.scene-placeholder', {}, z.name));
    }
  })();
}

function renderZone() {
  const body = root.querySelector('.zone-body');
  if (!body) return;
  const s = state();
  const d = data();
  const z = d.zones.zones.find((x) => x.id === zoneId);
  const task = workerTask(s, 'player');

  let card;
  if (task) {
    const node = d.zones.zones.find((x) => x.id === task.zone)?.harvest[task.skill]?.find((n) => n.id === task.node);
    const fill = el('div.fill');
    const text = el('span.small.muted');
    bar = { fill, text };
    card = el('div.panel', {},
      el('h2', {}, 'You'),
      el('p', {}, `${skillName(task.skill)}: ${node ? node.name : task.node}`),
      el('div.bar.big', {}, fill),
      text,
      el('div.row', { style: 'margin-top:8px' },
        el('button.btn', { type: 'button', onclick: () => send('harvest/stop', { worker: 'player' }) }, 'Stop')));
  } else {
    bar = null;
    card = el('div.panel', {}, el('h2', {}, 'You'), el('p', {}, "You're resting. Pick something to do below."));
  }

  const sections = [];
  xpBars = new Map();
  for (const sk of d.skills.skills) {
    const nodes = z.harvest?.[sk.id];
    if (sk.type !== 'harvest' || !nodes || !nodes.length) continue;
    const p = skillProgress(s, d, sk.id);
    const tool = toolFor(s, d, sk.id);
    const toolName = tool ? d.items.items[tool.item]?.name : null;
    const xpFill = el('div.fill');
    const xpText = el('p.small.muted');
    xpBars.set(sk.id, { fill: xpFill, text: xpText, toolName });
    sections.push(el('div.panel', {},
      el('h2', {}, `${sk.name} `, el('span.muted', {}, `Level ${p.level}`)),
      el('div.bar', {}, xpFill),
      xpText,
      ...nodes.map((n) => {
        const chk = nodeCheck(s, d, z.id, sk.id, n.id);
        const active = !!task && task.zone === z.id && task.skill === sk.id && task.node === n.id;
        return el(`button.node-btn${active ? '.active' : ''}${chk.ok ? '' : '.blocked'}`, {
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => (chk.ok ? send('harvest/assign', { worker: 'player', zone: z.id, skill: sk.id, node: n.id }) : toast(chk.reason)),
        },
          el('span.node-name', {}, n.name),
          el('span.node-drops', {}, [...new Set(n.drops.map((x) => x.item))].map((i) => itemIcon(i, 24, d.items.items[i]?.name))),
          el('span.node-lv', {}, `Lv ${n.level || 1}`));
      })));
  }
  if (!sections.length) sections.push(el('div.panel', {}, el('p', {}, 'Nothing to do here yet.')));
  body.replaceChildren(card, ...sections);
  updateXpBars();
  tickBar();
}

// ---------- smooth progress bar ----------
function startLoop() {
  if (raf) return;
  const frame = () => {
    raf = 0;
    if (!tabVisible) return;
    tickBar();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

function tickBar() {
  if (!bar || !zoneId) return;
  const s = state();
  const task = workerTask(s, 'player');
  if (!task) return;
  const dur = actionMs(s, data(), 'player', task);
  const w = s.workers.player;
  const now = performance.now();
  if (w.progressMs !== prog.value) prog = { value: w.progressMs, at: now };
  const shown = Math.min(dur, w.progressMs + (now - prog.at));
  bar.fill.style.width = `${(shown / dur) * 100}%`;
  bar.text.textContent = `${(dur / 1000).toFixed(1)} s per action`;
}
