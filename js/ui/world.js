// World tab: the zone map, and a page per zone with its scene, worker card and harvest nodes.
import { el, toast, sheetWithClose } from './dom.js';
import { getPref, setPref } from './device.js';
import { itemIcon, faceIcon } from './icons.js';
import { skillProgress } from '../systems/skills.js';
import { zoneUnlocked, nodeCheck, actionMs, workerTask, toolFor, isHarvestTask, playerCrafting } from '../systems/harvest.js';
import { stationList } from '../systems/crafting.js';
import { getPet, needsStarter, petStatus } from '../systems/pets.js';
import { petRole, petMaxEnergy, petRestPerHour, archetypeOf, canDig } from '../systems/petstats.js';
import { petDigMs } from '../systems/pets.js';
import {
  trackMs, revealChance, catchChance, encounterInfo, trapOptions, baitOptions, trapCheck, lureInfo, lureList, tamingNotice,
} from '../systems/taming.js';
import { mapItemFor, mapCount, digInfo } from '../systems/treasure.js';
import { masteryInfo } from './mastery.js';
import { randomName, renameSheet } from './petname.js';

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
let progs = new Map(); // key -> { value, at } for smooth progress
let live = []; // per-frame updaters for the numbers on the zone page (countdowns, bars)

export function mount(container, a) {
  app = a;
  root = el('div.world');
  container.append(root);
  app.game.subscribe(() => {
    if (!tabVisible) return;
    refresh();
    tickBar(); // also runs at the game tick rate if animation frames are throttled
  });
  app.game.onEvents((events) => {
    if (tabVisible) eventToasts(events);
  });
  const saved = getPref('worldZone', null);
  if (saved && app.game.data.zones.zones.some((z) => z.id === saved)) zoneId = saved;
  buildPage();
}

export function show() {
  tabVisible = true;
  if (zoneId) app.audio?.setScene(zoneId);
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
  app.audio?.setScene(id);
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
  if (zoneId) {
    updateXpBars();
    // Looking at a zone page counts as seeing the trap results (clears the World badge).
    if (tamingNotice(state()) && !seenQueued) {
      seenQueued = true;
      setTimeout(() => {
        seenQueued = false;
        if (tabVisible && zoneId && tamingNotice(state())) send('taming/seen');
      }, 0);
    }
  }
}
let seenQueued = false;

// skill id -> { fill, text, toolName } for the XP bars on the zone page
let xpBars = new Map();
function updateXpBars() {
  const s = state();
  for (const [sid, b] of xpBars) {
    const p = skillProgress(s, data(), sid);
    const m = p.max ? masteryInfo(s, data(), sid) : null;
    b.fill.style.width = `${m ? Math.round(m.frac * 100) : p.max ? 100 : Math.min(100, (p.xp / p.next) * 100)}%`;
    b.text.textContent = `${p.max ? (m ? m.text : 'Max level') : `${Math.floor(p.xp)} / ${p.next} XP`}${b.toolName ? ` - ${b.toolName}` : ''}`;
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
  const who = ws.map((w) => `${w.id}:${w.name}:${w.pet?.form || ''}${w.pet && canDig(data(), w.pet) ? 'D' : ''}:${taskKey(s.workers[w.id].task)}:${w.pet ? petStatus(s, w.id) : ''}`).join(',');
  const base = `${who}|${selectedWorker(s)}|${s.renown.rank}|${needsStarter(s) ? 'starter' : ''}`;
  if (!zoneId) return `${base}|${data().zones.zones.map((z) => zoneMarkKey(s, z.id)).join(',')}`;
  // Levels only: XP changes every action and is updated in place (rebuilding the buttons that
  // often could swallow a tap).
  const sk = Object.entries(s.skills).map(([k, v]) => `${k}${v.level}`).join(',');
  const tools = Object.values(s.tools).map((x) => x.item + x.quality).join(',');
  const d = data();
  const tm = s.taming;
  const mine = tm.results.map((r) => `${r.zone}${r.caught ? 1 : 0}${r.pet ? `${r.pet}=${s.pets.list[r.pet]?.name}` : ''}${r.trapKept ? 1 : 0}`).join(';');
  const lure = lureInfo(s, d);
  const stock = [...trapOptions(s, d, zoneId), ...lureList(s, d)].map((x) => `${x.key}${x.count}`).join(',');
  const wild = `${zoneMarkKey(s, zoneId)}|${tm.encounters[zoneId]?.msLeft === null ? 'w' : 'e'}|${trapCheck(s, d, zoneId).reason}|${lure ? lure.item : ''}|${mine}|${stock}`;
  return `${base}|${sk}|${tools}|${wild}|${craftingNames(s, d).join(',')}|${tamingNotice(s) ? 'n' : ''}`;
}

// Names of the stations the player is working at right now (empty when not crafting).
function craftingNames(s, d) {
  if (!playerCrafting(s)) return [];
  return stationList(s, d).filter((x) => x.working).map((x) => x.name);
}

// The zone page's sub-tab: remembered per device; falls back to Harvest if this zone lacks it.
let zoneTab = 'harvest';

// What shows on the map for a zone: waiting monster, set trap, number of maps.
function zoneMarkKey(s, zid) {
  const e = s.taming.encounters[zid];
  return `${zid}:${e ? `${e.archetype}${e.quality}` : ''}${s.taming.traps[zid] ? 't' : ''}${mapCount(s, data(), zid)}`;
}

// ---------- small formatters ----------
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const signed = (x) => `${x < 0 ? '-' : '+'}${pct(Math.abs(x))}`;
function fmtTime(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}
const itemName = (key) => data().items.items[key.split(':')[0]]?.name || key;
const mythicSpecies = (d, arch) => d.pets.mythics?.find((m) => m.archetype === arch)?.species || archetypeOf(d, arch)?.species || 'monster';
const encFace = (mythic, arch, px, label) => faceIcon(mythic ? `mythic.${arch}` : `pet.${arch}.hatchling`, px, label);

// Toasts for live taming and treasure events (only while the World tab is open).
function eventToasts(events) {
  const d = data();
  for (const e of events) {
    if (e.type === 'encounter') {
      toast(e.mythic
        ? `A mythic ${mythicSpecies(d, e.archetype)} has appeared! You will need a Starmetal Trap and Mythic Bait.`
        : `You found a wild ${archetypeOf(d, e.archetype)?.species || 'monster'}!`, e.mythic ? 4500 : 3000);
    } else if (e.type === 'trapDone') {
      const sp = e.mythic ? mythicSpecies(d, e.archetype) : archetypeOf(d, e.archetype)?.species || 'monster';
      toast(e.caught
        ? (e.mythic ? `The mythic ${sp} chose to stay with you! Say hi in the Pets tab.` : `${sp} was caught! Say hi in the Pets tab.`)
        : `The ${sp} slipped away.`, 3500);
    } else if (e.type === 'dig') {
      const best = e.items?.[d.treasure.relicItem] ? d.treasure.relicItem
        : e.items?.[d.treasure.eggItem] ? d.treasure.eggItem
          : Object.entries(e.items || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
      toast(`Dug up ${e.coins} coins${best ? ` and ${e.items[best]} x ${itemName(best)}` : ''}!`, 3000);
    }
  }
}

// ---------- map ----------
function renderMap() {
  const list = root.querySelector('.map-list');
  if (!list) return;
  const s = state();
  const d = data();
  const ws = workerList(s);
  mapTraps = new Map();
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
        working.push(`${w.name}: ${taskLabel(d, task, node)}`);
      }
    }
    const marks = [];
    if (open) {
      const enc = s.taming.encounters[z.id];
      if (enc && !s.taming.traps[z.id]) marks.push(el('span.zone-mark.alert', {}, enc.mythic ? '! A mythic is waiting' : '! Monster waiting'));
      if (s.taming.traps[z.id]) {
        const t = el('span');
        mapTraps.set(z.id, t);
        marks.push(el('span.zone-mark', {}, 'Trap set: ', t));
      }
      const maps = mapCount(s, d, z.id);
      if (maps > 0) marks.push(el('span.zone-mark', {}, itemIcon(mapItemFor(d, z.id), 18, 'Map'), `Maps: ${maps}`));
    }
    return el(`button.zone-card.panel${open ? '' : '.locked'}`, {
      type: 'button',
      onclick: () => (open ? openZone(z.id) : toast(note)),
    },
      el('div.zone-head', {}, el('b', {}, z.name), el('span.tier', {}, `Tier ${z.tier}`)),
      el('p.small.muted', {}, z.blurb),
      note && el('p.small.zone-note', {}, note),
      ...working.map((line) => el('p.small.zone-working', {}, line)),
      marks.length ? el('div.zone-marks', {}, ...marks) : null);
  }));
  tickBar();
}

let mapTraps = new Map(); // zone id -> span for the trap countdown on the map

// "Skill: node" for a harvest task, or the plain words for tracking and digging.
function taskLabel(d, task, node) {
  if (task.skill === 'taming') return 'Tracking';
  if (task.skill === 'treasure') return 'Digging for treasure';
  return `${skillName(task.skill)}: ${node ? node.name : task.node}`;
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

// One line for a worker who isn't picked: who and what they're doing (or resting). Tap to pick them.
function workerLine(s, d, w, task, z, pick) {
  let doing;
  if (!w.pet && playerCrafting(s)) doing = `Crafting at the ${craftingNames(s, d).join(' and the ') || 'station'}`;
  else if (task) {
    const tz = d.zones.zones.find((x) => x.id === task.zone);
    const node = tz?.harvest?.[task.skill]?.find((n) => n.id === task.node);
    doing = `${taskLabel(d, task, node)}${task.zone !== z.id && tz ? ` in ${tz.name}` : ''}`;
  } else doing = w.pet ? 'Not working yet' : 'Resting';
  // (The page redraws when a status changes, so the line says "resting" rather than a live energy number.)
  const energy = w.pet && petStatus(s, w.id) === 'resting' ? 'resting' : null;
  return el('button.worker-line', { type: 'button', onclick: () => pick(w.id) },
    w.pet ? faceIcon(petRole(w.pet), 24, w.name) : el('span.you-tag', {}, 'You'),
    el('span.worker-line-text', {},
      el('b', {}, w.pet ? w.name : 'You'),
      el('span.small.muted', {}, ` ${doing}${energy ? ` - ${energy}` : ''}`)));
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

  // "Who works?": the picked worker gets a full card; the others are one tappable line each (tap to pick).
  const chooser = el('div.panel.worker-head', {},
    el('h2', {}, 'Who works?'),
    el('p.small.muted', {}, 'Tap a name to pick, then tap a spot in the picture or a job below.'));
  const pickWorker = (id) => {
    setPref('worldWorker', id);
    refresh();
  };

  bars = new Map();
  const cards = ws.map((w) => {
    const task = workerTask(s, w.id);
    if (w.id !== sel) return workerLine(s, d, w, task, z, pickWorker);
    const rec = { pet: w.pet };
    const parts = [el('h2', {}, w.pet ? faceIcon(petRole(w.pet), 32, w.name) : null, el('span', {}, w.name),
      w.id === sel ? el('span.small.muted', {}, ' (picking jobs)') : null)];
    const crafting = !w.pet && playerCrafting(s);
    if (crafting) {
      // The player is at a station: their own job waits.
      const names = craftingNames(s, d);
      parts.push(el('p', {}, `Crafting at the ${names.join(' and the ') || 'station'}`));
      if (task) {
        const tz = d.zones.zones.find((x) => x.id === task.zone);
        const node = tz?.harvest?.[task.skill]?.find((n) => n.id === task.node);
        const where = task.zone !== z.id && tz ? ` in ${tz.name}` : '';
        parts.push(el('p.small.muted', {}, `Then back to: ${taskLabel(d, task, node)}${where}`));
      }
      parts.push(el('div.row', { style: 'margin-top:8px' },
        el('button.btn', { type: 'button', onclick: () => send('crafting/pause') }, 'Stop crafting')));
      bars.set(w.id, rec);
      return el(`div.panel.worker-card${w.id === sel ? '.selected' : ''}`, {}, ...parts);
    }
    if (task) {
      const tz = d.zones.zones.find((x) => x.id === task.zone);
      const node = tz?.harvest?.[task.skill]?.find((n) => n.id === task.node);
      const where = task.zone !== z.id && tz ? ` in ${tz.name}` : '';
      rec.fill = el('div.fill');
      rec.text = el('span.small.muted');
      const digLine = w.pet && task.skill === 'treasure'
        ? `${w.name} is digging (${mapCount(s, d, task.zone)} ${mapCount(s, d, task.zone) === 1 ? 'map' : 'maps'} left)${where}`
        : null;
      parts.push(el('p', {}, digLine || `${taskLabel(d, task, node)}${where}`),
        el('div.bar.big', {}, rec.fill), rec.text);
      const share = d.balance.pets.playerXpShare;
      if (w.pet && !digLine && share > 0) {
        const skill = d.skills.skills.find((x) => x.id === task.skill);
        if (skill) parts.push(el('p.small.muted', {}, `You get ${Math.round(share * 100)}% of the ${skill.name} XP it earns.`));
      }
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
  live = [];
  if (!sections.length) sections.push(el('div.panel', {}, el('p', {}, 'Nothing to do here yet.')));
  const defs = [{ id: 'harvest', name: 'Harvest', nodes: sections }];
  if (z.archetypes?.length) {
    const enc = s.taming.encounters[z.id];
    defs.push({ id: 'taming', name: 'Taming', nodes: [wildCard(s, d, z)], mark: (!!enc && !s.taming.traps[z.id]) || tamingNotice(s) });
  }
  if (mapItemFor(d, z.id)) defs.push({ id: 'treasure', name: 'Treasure', nodes: [treasureCard(s, d, z)] });
  zoneTab = getPref('zoneTab', 'harvest');
  if (!defs.some((x) => x.id === zoneTab)) zoneTab = 'harvest';
  const paneEls = {};
  const btnEls = {};
  const pick = (tid) => {
    zoneTab = tid;
    setPref('zoneTab', tid);
    for (const [k, p] of Object.entries(paneEls)) p.hidden = k !== tid;
    for (const [k, b] of Object.entries(btnEls)) b.setAttribute('aria-selected', k === tid ? 'true' : 'false');
  };
  const tabBar = defs.length > 1
    ? el('div.subtabs', { role: 'tablist', 'aria-label': 'Zone activities' }, defs.map((x) => {
      const b = el('button.subtab', { type: 'button', role: 'tab', onclick: () => pick(x.id) }, x.name,
        x.mark ? el('span.dot', { 'aria-label': 'needs attention' }) : null);
      btnEls[x.id] = b;
      return b;
    }))
    : null;
  for (const x of defs) paneEls[x.id] = el('div.subpane', { role: 'tabpanel' }, ...x.nodes);
  // Keep the scroll position across a rebuild.
  const scroller = root.closest('.screen') || root.parentElement;
  const top = scroller ? scroller.scrollTop : 0;
  body.replaceChildren(chooser, ...cards, ...(tabBar ? [tabBar] : []), ...Object.values(paneEls));
  pick(zoneTab);
  if (scroller && scroller.scrollTop !== top) scroller.scrollTop = top;
  updateXpBars();
  tickBar();
}

// ---------- wild monsters ----------
function wildCard(s, d, z) {
  const b = d.balance.taming;
  const info = encounterInfo(s, d, z.id);
  const task = workerTask(s, 'player');
  const tracking = task?.skill === 'taming' && task.zone === z.id;
  const p = skillProgress(s, d, 'taming');
  const xpFill = el('div.fill');
  const xpText = el('p.small.muted');
  xpBars.set('taming', { fill: xpFill, text: xpText, toolName: null });
  const parts = [
    el('h2', {}, 'Wild monsters ', el('span.muted', {}, `Taming ${p.level}`)),
    el('div.bar', {}, xpFill),
    xpText,
    el('p.small', {}, `Each try takes ${(trackMs(s, d, z.id) / 1000).toFixed(1)} s and has a ${pct(revealChance(s, d))} chance to find a monster. Once you find one, you go back to what you were harvesting. Active Scout pets help you track.`),
    el(`button.btn.wide${tracking ? '.on' : ''}`, {
      type: 'button',
      'aria-pressed': tracking ? 'true' : 'false',
      onclick: () => send('taming/track', { zone: z.id }),
    }, tracking ? 'Tracking...' : 'Track wild monsters'),
  ];
  if (info) parts.push(encounterBlock(s, d, z, info, b));
  const results = s.taming.results.filter((r) => r.zone === z.id).reverse();
  if (results.length) {
    parts.push(el('h3.wild-sub', {}, 'Recent results'),
      ...results.map((r) => {
        const sp = r.mythic ? mythicSpecies(d, r.archetype) : archetypeOf(d, r.archetype)?.species || 'monster';
        const pet = r.pet ? s.pets.list[r.pet] : null;
        const hi = `Say hi${pet && pet.name !== sp ? ` to ${pet.name}` : ''} in the Pets tab.`;
        const text = r.caught
          ? (r.mythic ? `The mythic ${sp} chose to stay with you! What a wonderful day. ${hi}` : `${sp} was caught! ${hi}`)
          : `The ${sp} slipped away. ${r.trapKept ? 'Your trap came back safe.' : 'The trap broke.'}`;
        const line = el(`p.small.wild-result${r.caught ? '.good' : ''}${r.mythic ? '.mythic' : ''}`, {},
          encFace(r.mythic, r.archetype, 24, sp), el('span', {}, text));
        // A caught pet is named after its species until the player names it.
        if (!pet || pet.name !== sp) return line;
        return el('div', {}, line, el('button.btn.wide', {
          type: 'button',
          onclick: () => renameSheet(app.game, pet, { title: `Name your ${sp}`, start: randomName(d) }),
        }, `Give the ${sp} a name`));
      }));
  }
  // Lure
  const lure = lureInfo(s, d);
  const lures = lureList(s, d);
  parts.push(el('h3.wild-sub', {}, 'Lures'));
  if (lure) {
    const t = el('b');
    live.push((st, dd, now) => {
      const l = lureInfo(st, dd);
      if (l) t.textContent = fmtTime(smooth('lure', l.msLeft, -1, true, now));
    });
    parts.push(el('p.small', {}, `${lure.def?.name || 'A lure'} is working: `, t, ' left.'));
  }
  parts.push(el('p.small.muted', {}, 'Monsters you find while a lure works are one quality higher.'));
  if (lures.length) {
    parts.push(...lures.map((l) => el('button.node-btn', {
      type: 'button',
      onclick: () => send('taming/useLure', { item: l.key }),
    }, itemIcon(l.key, 28, l.item.name), el('span.node-name', {}, `Use a ${l.item.name}`),
    el('span.node-lv', {}, `x${l.count} - ${l.minutes} min`))));
  } else if (!lure) {
    parts.push(el('p.small.muted', {}, 'You have no lures. Brew one at the Alchemy Lab.'));
  }
  return el('div.panel.wild-card', {}, ...parts);
}

function encounterBlock(s, d, z, info, b) {
  const box = el('div.encounter');
  if (info.mythic) box.classList.add('mythic');
  box.append(el('div.enc-head', {},
    encFace(info.mythic, info.archetype, 56, info.species),
    el('div.enc-text', {},
      info.mythic ? el('span.enc-mythic', {}, 'Mythic!') : null,
      el('b', {}, info.mythic ? `A mythic ${info.species}` : `A wild ${info.species}`),
      el(`span.enc-hint${info.special || info.mythic ? '.special' : ''}`, {}, info.hint))));
  if (info.mythic && !info.trap) {
    box.append(el('p.small.mythic-note', {}, 'A mythic only comes close to a Starmetal Trap baited with Mythic Bait. You need both.'));
  }
  const trap = info.trap;
  if (trap) {
    const fill = el('div.fill');
    const t = el('span.small');
    box.append(
      el('p.small', {}, `${itemName(trap.item)} is set${trap.bait ? ` with ${itemName(trap.bait)}` : ''}. Catch chance ${pct(trap.chance)}.`),
      el('div.bar.big', {}, fill), t);
    const total = b.trapMinutes * 60000;
    live.push((st, dd, now) => {
      const tr = st.taming.traps[z.id];
      if (!tr) return;
      const left = Math.max(0, smooth(`trap${z.id}`, tr.msLeft, -1, true, now));
      fill.style.width = `${(1 - left / total) * 100}%`;
      t.textContent = `Ready in ${fmtTime(left)}`;
    });
    return box;
  }
  if (info.msLeft !== null) {
    const t = el('p.small.muted');
    box.append(t);
    live.push((st, dd, now) => {
      const e = st.taming.encounters[z.id];
      if (e && e.msLeft !== null) t.textContent = `It got away once. It will wander off in ${fmtTime(smooth(`enc${z.id}`, e.msLeft, -1, true, now))}.`;
    });
  }
  const check = trapCheck(s, d, z.id);
  const hasTraps = trapOptions(s, d, z.id).length > 0;
  box.append(
    el('div.row', {},
      el('button.btn', {
        type: 'button',
        onclick: () => (check.ok ? openTrapSheet(z.id) : toast(check.reason)),
      }, 'Set a trap'),
      el('button.btn.small-btn', { type: 'button', onclick: () => send('taming/letGo', { zone: z.id }) }, 'Let it go')));
  if (!check.ok) box.append(el('p.small.muted', {}, check.reason));
  else if (!hasTraps) box.append(el('p.small.muted', {}, 'You have no traps. Traps are made at the Workbench (a frame and a spring). The first one can be bought in Mossbrook.'));
  return box;
}

function openTrapSheet(zid) {
  const s0 = state();
  const d = data();
  const info = encounterInfo(s0, d, zid);
  if (!info) return;
  const traps = trapOptions(s0, d, zid);
  const baits = baitOptions(s0, d, zid);
  let trap = traps.find((t) => t.ok)?.key || null;
  let bait = info.mythic ? baits.find((bt) => bt.match)?.key || null : null;
  const trapBox = el('div');
  const baitBox = el('div');
  const chanceBox = el('div.catch-box');
  const go = el('button.btn.wide', { type: 'button' }, 'Set trap');
  let close = () => {};
  const draw = () => {
    const s = state();
    const check = trapCheck(s, d, zid);
    trapBox.replaceChildren(el('h3.wild-sub', {}, 'Trap'),
      ...(traps.length ? traps.map((t) => el(`button.node-btn${t.key === trap ? '.active' : ''}${t.ok ? '' : '.blocked'}`, {
        type: 'button',
        'aria-pressed': t.key === trap ? 'true' : 'false',
        onclick: () => {
          if (!t.ok) return toast(t.reason);
          trap = t.key;
          draw();
        },
      }, itemIcon(t.key, 28, t.item.name),
      el('span.node-name', {}, t.item.name, t.ok ? null : el('span.small.muted.block', {}, t.reason)),
      el('span.node-lv', {}, `x${t.count}`)))
        : [el('p.small.muted', {}, 'You have no traps. Traps are made at the Workbench (a frame and a spring). The first one can be bought in Mossbrook.')]));
    baitBox.replaceChildren(...[el('h3.wild-sub', {}, info.mythic ? 'Bait (required)' : 'Bait (optional)'),
      info.mythic ? el('p.small.muted', {}, 'A mythic needs a Starmetal Trap and Mythic Bait. Nothing else will do.') : null,
      info.mythic ? null : el(`button.node-btn${bait === null ? '.active' : ''}`, {
        type: 'button',
        'aria-pressed': bait === null ? 'true' : 'false',
        onclick: () => {
          bait = null;
          draw();
        },
      }, el('span.node-name', {}, 'No bait')),
      info.mythic && !baits.some((bt) => bt.match) ? el('p.small.warn', {}, 'You have no Mythic Bait. Brew some first.') : null,
      ...baits.filter((bt) => !info.mythic || bt.match).map((bt) => el(`button.node-btn${bt.key === bait ? '.active' : ''}`, {
        type: 'button',
        'aria-pressed': bt.key === bait ? 'true' : 'false',
        onclick: () => {
          bait = bt.key;
          draw();
        },
      }, itemIcon(bt.key, 28, bt.item.name),
      el('span.node-name', {}, bt.item.name, bt.match ? el('span.small.loves.block', {}, `${info.species} loves this!`) : null),
      el('span.node-lv', {}, `x${bt.count}`)))].filter(Boolean));
    if (trap) {
      const c = catchChance(s, d, zid, trap, bait);
      const rows = [['Base', c.base]];
      if (c.trap) rows.push(['Better trap', c.trap]);
      rows.push(['Bait', c.bait], ['Your Taming level', c.level]);
      chanceBox.replaceChildren(
        el('p.catch-total', {}, 'Catch chance ', el('b', {}, pct(c.chance))),
        ...rows.map(([name, v]) => el('p.small.muted.catch-row', {}, el('span', {}, name), el('span', {}, name === 'Base' ? pct(v) : signed(v)))),
        ...(c.capped ? [el('p.small.muted', {}, 'This is the most it can be.')] : []),
        el('p.small.muted', {}, `The trap takes ${d.balance.taming.trapMinutes} minutes.`));
    } else {
      chanceBox.replaceChildren(el('p.small.muted', {}, 'Pick a trap to see the chance.'));
    }
    go.disabled = !trap || !check.ok || (info.mythic && !bait);
    if (!check.ok) chanceBox.append(el('p.small.warn', {}, check.reason));
  };
  go.addEventListener('click', () => {
    send('taming/setTrap', { zone: zid, trap, bait });
    close();
  });
  close = sheetWithClose('Cancel', info.mythic ? `Trap the mythic ${info.species}` : `Trap the ${info.species}`, trapBox, baitBox, chanceBox, go);
  draw();
}

// ---------- treasure ----------
function treasureCard(s, d, z) {
  const info = digInfo(s, d, z.id);
  const mapItem = mapItemFor(d, z.id);
  const fill = el('div.fill');
  const t = el('p.small.muted');
  live.push((st, dd, now) => {
    const i = digInfo(st, dd, z.id);
    const shown = Math.max(0, Math.min(i.total, smooth(`dig${z.id}`, i.ms, 1, i.digging, now)));
    fill.style.width = `${(shown / i.total) * 100}%`;
    t.textContent = i.digging || i.ms > 0 ? `${fmtTime(i.total - shown)} left on this map` : `Each map takes about ${fmtTime(i.total)} to dig.`;
  });
  const none = info.maps <= 0;
  return el('div.panel.treasure-card', {},
    el('h2', {}, 'Treasure'),
    el('div.map-line', {}, itemIcon(mapItem, 32, 'Map'),
      el('span', {}, el('b', {}, `${info.maps} ${info.maps === 1 ? 'map' : 'maps'}`), ` for ${z.name}`)),
    el('p.small.muted', {}, 'Maps turn up while harvesting, most often while fishing. You dig them up one after another, then go back to what you were doing.'),
    ...withScoutNote(scoutRows(s, d, z, none)),
    el(`button.btn.wide${info.digging ? '.on' : ''}`, {
      type: 'button',
      'aria-pressed': info.digging ? 'true' : 'false',
      disabled: none && !info.digging,
      onclick: () => send('treasure/dig', { zone: z.id }),
    }, info.digging ? 'Digging...' : 'Dig for treasure'),
    none ? el('p.small.warn', {}, 'No maps to dig yet.') : null,
    el('div.bar.big', {}, fill),
    t);
}

function withScoutNote(rows) {
  return rows.length ? [el('p.small.muted', {}, 'Scout pets can dig too:'), ...rows] : [];
}

// One "Dig treasure" button per active Scout pet (pets that can dig), with a live bar while it digs.
function scoutRows(s, d, z, none) {
  const rows = [];
  for (const pid of s.pets.active) {
    const pet = pid ? getPet(s, pid) : null;
    if (!pet || !s.workers[pid] || !canDig(d, pet)) continue;
    const task = s.workers[pid].task;
    const here = task?.skill === 'treasure' && task.zone === z.id;
    const elsewhere = task?.skill === 'treasure' && !here;
    const fill = el('div.fill');
    const t = el('span.small.muted');
    live.push((st, dd, now) => {
      const w = st.workers[pid];
      const p = getPet(st, pid);
      if (!w || !p || w.task?.skill !== 'treasure' || w.task.zone !== z.id) return;
      const dur = petDigMs(st, dd, p);
      const moving = petStatus(st, pid) === 'working';
      const shown = Math.max(0, Math.min(dur, smooth(`petdig${pid}`, w.progressMs, 1, moving, now)));
      const n = mapCount(st, dd, z.id);
      fill.style.width = `${(shown / dur) * 100}%`;
      t.textContent = `${p.name} is digging (${n} ${n === 1 ? 'map' : 'maps'} left) - ${fmtTime(dur - shown)} on this map`;
    });
    rows.push(el('div.scout-row', {},
      el(`button.btn.wide${here ? '.on' : ''}`, {
        type: 'button',
        'aria-pressed': here ? 'true' : 'false',
        disabled: none && !here,
        onclick: () => send('treasure/dig', { zone: z.id, worker: pid }),
      }, faceIcon(petRole(pet), 24, pet.name), el('span', {}, here ? ` ${pet.name} is digging...` : ` Dig treasure with ${pet.name}`)),
      elsewhere ? el('p.small.muted', {}, `${pet.name} is digging in another zone. Tapping sends it here.`) : null,
      here ? el('div.bar.big', {}, fill) : null,
      here ? t : null));
  }
  return rows;
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

// A number that changes once per game tick, smoothed between ticks. dir +1 counts up, -1 down.
function smooth(key, value, dir, moving, now) {
  let p = progs.get(key);
  if (!p || value !== p.value) {
    p = { value, at: now };
    progs.set(key, p);
  }
  return value + (moving ? dir * (now - p.at) : 0);
}

function tickBar() {
  const s = state();
  const d = data();
  const now = performance.now();
  if (!zoneId) {
    for (const [zid, span] of mapTraps) {
      const tr = s.taming.traps[zid];
      if (tr) span.textContent = fmtTime(smooth(`mapTrap${zid}`, tr.msLeft, -1, true, now));
    }
    return;
  }
  for (const fn of live) fn(s, d, now);
  for (const [wid, rec] of bars) {
    const w = s.workers[wid];
    const task = w?.task;
    if (rec.fill && task) {
      let dur;
      let value = w.progressMs;
      if (isHarvestTask(d, task)) {
        dur = actionMs(s, d, wid, task);
      } else if (task.skill === 'taming') {
        dur = trackMs(s, d, task.zone);
      } else if (rec.pet) {
        const pet = getPet(s, wid);
        dur = pet ? petDigMs(s, d, pet) : 1;
        value = w.progressMs;
      } else {
        dur = digInfo(s, d, task.zone).total;
        value = s.treasure.progress[task.zone] || 0;
      }
      // A resting pet is not making progress, so only a working one is smoothed forward.
      const moving = !rec.pet || petStatus(s, wid) === 'working';
      const shown = Math.max(0, Math.min(dur, smooth(wid, value, 1, moving, now)));
      rec.fill.style.width = `${(shown / dur) * 100}%`;
      rec.text.textContent = task.skill === 'treasure' ? `${fmtTime(dur - shown)} left on this map`
        : `${(dur / 1000).toFixed(1)} s per ${task.skill === 'taming' ? 'try' : 'action'}`;
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
