// World tab: the zone map, and a page per zone with its scene, worker card and harvest nodes.
import { el, toast, sheetWithClose } from './dom.js';
import { getPref, setPref } from './device.js';
import { itemIcon, faceIcon } from './icons.js';
import { skillProgress } from '../systems/skills.js';
import { zoneUnlocked, nodeCheck, actionMs, workerTask, toolFor } from '../systems/harvest.js';
import { getPet, needsStarter, petStatus } from '../systems/pets.js';
import { petRole, petMaxEnergy, petRestPerHour } from '../systems/petstats.js';

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
let bars = new Map(); // workerId -> { fill, text, pet, eFill, eText, status } for the worker cards
let raf = 0;
let progs = new Map(); // workerId -> { value, at } for smooth progress

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
  bars = new Map();
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

// Everyone who can work: the player, then each pet in an active slot.
function workerList(s) {
  const list = [{ id: 'player', name: 'You', pet: null }];
  for (const pid of s.pets.active) {
    const pet = pid ? getPet(s, pid) : null;
    if (pet && s.workers[pid]) list.push({ id: pid, name: pet.name, pet });
  }
  return list;
}

// The worker a tapped node is given to (falls back to the player if that pet is gone).
function selectedWorker(s) {
  const id = getPref('worldWorker', 'player');
  return workerList(s).some((w) => w.id === id) ? id : 'player';
}

const taskKey = (t) => (t ? `${t.zone}/${t.skill}/${t.node}` : '-');

function keyFor() {
  const s = state();
  const ws = workerList(s);
  const who = ws.map((w) => `${w.id}:${w.name}:${w.pet?.form || ''}:${taskKey(s.workers[w.id].task)}:${w.pet ? petStatus(s, w.id) : ''}`).join(',');
  const base = `${who}|${selectedWorker(s)}|${s.renown.rank}|${needsStarter(s) ? 'starter' : ''}`;
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
  const ws = workerList(s);
  const starter = needsStarter(s)
    ? el('div.panel.starter-panel', {}, el('p', {}, 'Your first pet is waiting: open the Pets tab to choose an egg.'))
    : null;
  list.replaceChildren(...(starter ? [starter] : []), ...d.zones.zones.map((z) => {
    const open = zoneUnlocked(s, d, z.id);
    const nodes = Object.values(z.harvest || {}).reduce((n, a) => n + a.length, 0);
    let note = null;
    if (!open) {
      note = z.unlock?.grandProject != null ? 'Opens after the fifth Grand Project' : `Opens at Renown ${z.unlock?.renown}`;
    } else if (!nodes) {
      note = 'Nothing to do here yet';
    }
    const working = [];
    if (open) {
      for (const w of ws) {
        const task = s.workers[w.id].task;
        if (!task || task.zone !== z.id) continue;
        const node = z.harvest[task.skill]?.find((n) => n.id === task.node);
        working.push(`${w.name}: ${skillName(task.skill)} - ${node ? node.name : task.node}`);
      }
    }
    return el(`button.zone-card.panel${open ? '' : '.locked'}`, {
      type: 'button',
      onclick: () => (open ? openZone(z.id) : toast(note)),
    },
      el('div.zone-head', {}, el('b', {}, z.name), el('span.tier', {}, `Tier ${z.tier}`)),
      el('p.small.muted', {}, z.blurb),
      note && el('p.small.zone-note', {}, note),
      ...working.map((line) => el('p.small.zone-working', {}, line)));
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
      const sc = await createZoneScene(host, app.game, z.id, { onSpotTap: (skillId) => tapSpot(z.id, skillId) });
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

// A spot tapped in the scene (the tree, the pond...): give that job to the worker picked under
// "Who works?". One thing to do there starts at once; several open a short list to pick from.
function tapSpot(zid, skillId) {
  const s = state();
  const d = data();
  const z = d.zones.zones.find((x) => x.id === zid);
  const nodes = z?.harvest?.[skillId] || [];
  if (!nodes.length) {
    toast('Nothing to do there yet.');
    return;
  }
  const sel = selectedWorker(s);
  const who = workerList(s).find((w) => w.id === sel);
  const assign = (n) => send('harvest/assign', { worker: sel, zone: zid, skill: skillId, node: n.id });
  if (nodes.length === 1) {
    const chk = nodeCheck(s, d, zid, skillId, nodes[0].id);
    if (chk.ok) assign(nodes[0]);
    else toast(chk.reason);
    return;
  }
  const task = workerTask(s, sel);
  const sk = d.skills.skills.find((x) => x.id === skillId);
  let close = null;
  const rows = nodes.map((n) => {
    const chk = nodeCheck(s, d, zid, skillId, n.id);
    const active = !!task && task.zone === zid && task.skill === skillId && task.node === n.id;
    return el(`button.node-btn${active ? '.active' : ''}${chk.ok ? '' : '.blocked'}`, {
      type: 'button',
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => {
        if (!chk.ok) {
          toast(chk.reason);
          return;
        }
        assign(n);
        close();
      },
    },
      el('span.node-name', {}, n.name),
      el('span.node-drops', {}, [...new Set(n.drops.map((x) => x.item))].map((i) => itemIcon(i, 24, d.items.items[i]?.name))),
      el('span.node-lv', {}, `Lv ${n.level || 1}`));
  });
  close = sheetWithClose('Cancel', `${sk ? sk.verb : skillName(skillId)} where?`,
    el('p.small.muted', {}, who && who.pet ? `For ${who.name}` : 'For you'),
    ...rows);
}

function renderZone() {
  const body = root.querySelector('.zone-body');
  if (!body) return;
  const s = state();
  const d = data();
  const z = d.zones.zones.find((x) => x.id === zoneId);
  const ws = workerList(s);
  const sel = selectedWorker(s);
  const selTask = workerTask(s, sel);

  const chooser = el('div.panel', {},
    el('h2', {}, 'Who works?'),
    el('p.small.muted', {}, 'Then tap a spot in the picture, or pick a job below.'),
    el('div.worker-chips', {}, ws.map((w) =>
      el('button.chip', {
        type: 'button',
        'aria-pressed': w.id === sel ? 'true' : 'false',
        onclick: () => {
          setPref('worldWorker', w.id);
          refresh();
        },
      }, w.pet ? faceIcon(petRole(w.pet), 24, w.name) : null, el('span', {}, w.name)))));

  bars = new Map();
  const cards = ws.map((w) => {
    const task = workerTask(s, w.id);
    const rec = { pet: w.pet };
    const parts = [el('h2', {}, w.pet ? faceIcon(petRole(w.pet), 32, w.name) : null, el('span', {}, w.name),
      w.id === sel ? el('span.small.muted', {}, ' (picking jobs)') : null)];
    if (task) {
      const tz = d.zones.zones.find((x) => x.id === task.zone);
      const node = tz?.harvest[task.skill]?.find((n) => n.id === task.node);
      const where = task.zone !== z.id && tz ? ` in ${tz.name}` : '';
      rec.fill = el('div.fill');
      rec.text = el('span.small.muted');
      parts.push(el('p', {}, `${skillName(task.skill)}: ${node ? node.name : task.node}${where}`),
        el('div.bar.big', {}, rec.fill), rec.text);
    } else {
      parts.push(el('p', {}, w.pet ? 'Not working yet.' : "You're resting. Pick something to do below."));
    }
    if (w.pet) {
      rec.eFill = el('div.fill.energy');
      rec.eText = el('span.small.muted');
      rec.status = el('p.small');
      parts.push(el('div.bar', {}, rec.eFill), rec.eText, rec.status);
    }
    if (task) {
      parts.push(el('div.row', { style: 'margin-top:8px' },
        el('button.btn', { type: 'button', onclick: () => send('harvest/stop', { worker: w.id }) }, 'Stop')));
    }
    bars.set(w.id, rec);
    return el(`div.panel.worker-card${w.id === sel ? '.selected' : ''}`, {}, ...parts);
  });
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
        const on = (t) => !!t && t.zone === z.id && t.skill === sk.id && t.node === n.id;
        const active = on(selTask);
        const here = ws.filter((w) => on(workerTask(s, w.id)));
        return el(`button.node-btn${active ? '.active' : ''}${chk.ok ? '' : '.blocked'}`, {
          type: 'button',
          'aria-pressed': active ? 'true' : 'false',
          onclick: () => (chk.ok ? send('harvest/assign', { worker: sel, zone: z.id, skill: sk.id, node: n.id }) : toast(chk.reason)),
        },
          el('span.node-name', {}, n.name),
          here.length ? el('span.node-workers', {}, here.map((w) =>
            (w.pet ? faceIcon(petRole(w.pet), 20, w.name) : el('span.you-tag', {}, 'You')))) : null,
          el('span.node-drops', {}, [...new Set(n.drops.map((x) => x.item))].map((i) => itemIcon(i, 24, d.items.items[i]?.name))),
          el('span.node-lv', {}, `Lv ${n.level || 1}`));
      })));
  }
  if (!sections.length) sections.push(el('div.panel', {}, el('p', {}, 'Nothing to do here yet.')));
  body.replaceChildren(chooser, ...cards, ...sections);
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
  if (!bars.size || !zoneId) return;
  const s = state();
  const d = data();
  const now = performance.now();
  for (const [wid, rec] of bars) {
    const w = s.workers[wid];
    const task = w?.task;
    if (rec.fill && task) {
      const dur = actionMs(s, d, wid, task);
      let p = progs.get(wid);
      if (!p || w.progressMs !== p.value) {
        p = { value: w.progressMs, at: now };
        progs.set(wid, p);
      }
      // A resting pet is not making progress, so only a working one is smoothed forward.
      const moving = !rec.pet || petStatus(s, wid) === 'working';
      const shown = Math.min(dur, w.progressMs + (moving ? now - p.at : 0));
      rec.fill.style.width = `${(shown / dur) * 100}%`;
      rec.text.textContent = `${(dur / 1000).toFixed(1)} s per action`;
    }
    if (rec.pet) {
      const pet = getPet(s, wid);
      if (!pet) continue;
      const max = petMaxEnergy(d, pet);
      rec.eFill.style.width = `${Math.min(100, (pet.energy / max) * 100)}%`;
      rec.eText.textContent = `Energy ${Math.floor(pet.energy)} / ${Math.round(max)}`;
      const st = petStatus(s, wid);
      if (st === 'working') {
        rec.status.textContent = 'Working';
      } else if (st === 'resting') {
        const mins = Math.max(1, Math.ceil(((max - pet.energy) / petRestPerHour(s, d, pet)) * 60));
        rec.status.textContent = `Resting - back to work in about ${mins} min`;
      } else {
        rec.status.textContent = 'Idle - pick a job below';
      }
    }
  }
}
