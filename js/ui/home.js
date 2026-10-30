// Home tab: the homestead scene on a PixiJS canvas, plus the building sheets (list and detail).
import { el, toast } from './dom.js';
import { itemIcon } from './icons.js';
import { itemCount } from '../systems/bag.js';
import { openMossbrook } from './mossbrook.js';
import { openSanctuary } from './sanctuary.js';
import { openElderGrove } from './elders.js';
import { playScene, scenePlaying } from './story.js';
import { closeSheet } from './layer.js';
import { openPetSheet } from './petplay.js';
import { pendingScene } from '../systems/sanctuary.js';
import { plotList, seedList, plotCount } from '../systems/garden.js';
import { buildingList, buildingDef, buildingTier, tierCost, lookName, effectLines, upgradeCheck } from '../systems/buildings.js';

export const id = 'home';
export const label = 'Home';
export const icon = 'assets/ui/tab-home.png';
export const canvas = true;

let scene = null;
let visible = false;
let app = null;
let layer = null; // the open sheet: { backdrop, unsub }
let sceneReady = false; // the Pixi scene has loaded (or failed), so a project scene can use it

export function mount(container, a) {
  app = a;
  container.append(el('div.home-btns', {},
    el('button.btn.home-buildings-btn', { type: 'button', onclick: () => openMossbrook(app) }, 'Mossbrook'),
    el('button.btn.home-buildings-btn', { type: 'button', onclick: () => openSanctuary(app) }, 'Sanctuary'),
    el('button.btn.home-buildings-btn', { type: 'button', onclick: openList }, 'Buildings')));
  // PixiJS is large, so it loads only when Home is first shown.
  import('../render/homeScene.js')
    .then(({ createHomeScene }) => createHomeScene(container, app.game, { onTap: handleTap }))
    .then((s) => {
      scene = s;
      if (visible) scene.start();
      else scene.stop();
    })
    .catch((err) => {
      console.error(err);
      container.append(el('div.home-error.panel.small', {}, 'The scene could not start on this device. The Buildings button still works.'));
    })
    .finally(() => {
      sceneReady = true;
      maybePlayScene();
    });
  // A delivery that finishes a project plays its scene right away while Home is showing.
  app.game.subscribe(maybePlayScene);
}

// Plays the next finished project's scene (one at a time; playScene ignores a second call).
function maybePlayScene() {
  if (!visible || !sceneReady || !app || scenePlaying()) return;
  const project = pendingScene(state());
  if (!project) return;
  closeLayer();
  closeSheet();
  playScene(app, project, scene);
}

export function show() {
  visible = true;
  scene?.start();
  maybePlayScene();
}

export function hide() {
  visible = false;
  scene?.stop();
  closeLayer();
  closeSheet();
}

const data = () => app.game.data;
const state = () => app.game.getState();
const itemName = (itemId) => data().items.items[itemId]?.name || itemId;

function handleTap(target) {
  if (!target) return;
  if (target.kind === 'building') {
    openBuilding(target.id);
  } else if (target.kind === 'pet') {
    openPetSheet(app.game, target.id, (petId) => app.openPet?.(petId));
  } else if (target.kind === 'decor') {
    const label = data().buildings.decor?.find((d) => d.prop === target.prop)?.label;
    if (target.prop === 'signpost') openMossbrook(app);
    else if (target.prop === 'sanctuary_ruins') openSanctuary(app);
    else if (target.prop === 'elder_grove') openElderGrove(app);
  }
}

// ---- sheet plumbing ----

function closeLayer() {
  if (!layer) return;
  layer.unsub?.();
  layer.backdrop.remove();
  layer = null;
}

// Opens a bottom sheet. buildBody(body, foot) fills the scroll area and the pinned footer; it runs
// again only when keyFn() returns a different value.
function openLayer(title, buildBody, keyFn) {
  closeLayer();
  const body = el('div.hs-body');
  const foot = el('div.hs-foot');
  const backdrop = el('div.sheet-backdrop.home-sheet-backdrop', { onclick: (e) => e.target === backdrop && closeLayer() },
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
    foot.append(el('button.btn.wide', { type: 'button', onclick: closeLayer }, 'Close'));
    body.scrollTop = scroll;
  };
  layer = { backdrop, unsub: app.game.subscribe(render) };
  render();
}

// ---- building list ----

function openList() {
  const key = () => buildingList(state(), data()).map((b) => `${b.id}:${b.tier}:${b.check.ok}`).join('|');
  openLayer('Buildings', (body) => {
    for (const b of buildingList(state(), data())) {
      let chip = null;
      if (b.check.ok) chip = el('span.hs-chip.ready', {}, 'Ready');
      else if (b.tier === 0) chip = el('span.hs-chip.locked', {}, `Opens at Renown ${b.unlock?.renown ?? 1}`);
      body.append(el('button.hs-row', { type: 'button', onclick: () => openBuilding(b.id) },
        el('span.hs-row-main', {},
          el('span.hs-row-name', {}, b.name),
          el('span.small.muted', {}, b.tier > 0
            ? `${lookName(data(), b.id, b.tier)}, tier ${b.tier} of ${data().balance.buildings.maxTier}`
            : 'Not built yet')),
        chip));
    }
  }, key);
}

// ---- one building ----

function openBuilding(buildingId) {
  const def = buildingDef(data(), buildingId);
  if (!def) return;
  const key = () => {
    const s = state();
    const t = buildingTier(s, buildingId);
    const c = tierCost(data(), buildingId, t + 1);
    const parts = [t, s.coins, s.renown.rank, buildingTier(s, 'cottage')];
    if (buildingId === 'garden') parts.push(gardenKey(s));
    if (c) {
      for (const it of Object.keys(c.items)) parts.push(itemCount(s, it));
      if (c.blueprint) parts.push(itemCount(s, c.blueprint));
    }
    return parts.join('/');
  };
  openLayer(def.name, (body, foot) => buildDetail(body, foot, def), key);
}

function effectBlock(heading, lines, compareTo) {
  return el('div.hs-effects', {},
    el('h3', {}, heading),
    lines.length
      ? el('ul', {}, lines.map((l) => el(compareTo && !compareTo.includes(l) ? 'li.diff' : 'li', {}, l)))
      : el('p.small.muted', {}, 'Nothing yet.'));
}

function buildDetail(body, foot, def) {
  const d = data();
  const s = state();
  const maxTier = d.balance.buildings.maxTier;
  const tier = buildingTier(s, def.id);
  const check = upgradeCheck(s, d, def.id);
  const look = lookName(d, def.id, tier);

  body.append(
    el('p.hs-look', {}, look || 'Empty plot'),
    el('p.small.muted', {}, tier > 0 ? `Tier ${tier} of ${maxTier}` : 'Not built yet'),
    el('p', {}, def.blurb));

  const nowLines = effectLines(s, d, def.id, tier);
  body.append(effectBlock('Now', nowLines));
  if (def.id === 'garden' && tier > 0) gardenSection(body);

  if (check.cost) {
    body.append(effectBlock(`Next: ${lookName(d, def.id, check.next)}`, effectLines(s, d, def.id, check.next), nowLines));
    body.append(costBlock(check, s));
  } else {
    body.append(el('p.hs-done', {}, check.reason));
  }

  if (check.cost) {
    if (!check.ok) {
      foot.append(el('p.hs-reason', {}, check.reason));
      for (const h of hints(check)) foot.append(h);
    }
    foot.append(el('button.btn.wide.hs-upgrade', {
      type: 'button',
      disabled: !check.ok,
      onclick: () => upgrade(def),
    }, tier === 0 ? `Build ${lookName(d, def.id, check.next)}` : `Upgrade to ${lookName(d, def.id, check.next)}`));
  }
}

// ---- Garden ----

function gardenSection(body) {
  const s = state();
  const d = data();
  const plots = plotList(s, d);
  const seeds = seedList(s, d);
  body.append(el('h3', {}, `Plots (${plotCount(s, d)})`));
  if (!seeds.length && plots.some((p) => !p.seed)) {
    body.append(el('p.small.muted', {}, 'You have no seeds. Seeds are sold in the Mossbrook market.'),
      el('button.btn.wide', { type: 'button', onclick: () => openMossbrook(app, 'market', 'buy') }, 'Open the Mossbrook market'));
  }
  for (const p of plots) {
    if (!p.seed) {
      body.append(el('button.gd-plot', { type: 'button', onclick: () => seedPicker(p.index) },
        el('span.item-icon'), el('span.gd-plot-body', {}, 'Empty - plant a seed')));
      continue;
    }
    const frac = p.growMs > 0 ? Math.min(1, p.ms / p.growMs) : 0;
    const fill = el('div.fill');
    fill.style.width = `${Math.round(frac * 100)}%`;
    body.append(el('div.gd-plot', {},
      itemIcon(p.crop, 32, itemName(p.crop)),
      el('div.gd-plot-body', {},
        el('div', {}, itemName(p.crop)),
        el('div.bar', {}, fill),
        el('div.small.muted', {}, `${fmtLeft(p.left)} left`),
        el('div.gd-actions', {},
          el('button.btn', { type: 'button', onclick: () => confirmClear(p) }, 'Dig up'),
          el('button.btn', {
            type: 'button', 'aria-pressed': String(!!p.auto),
            onclick: () => run('garden/auto', { plot: p.index, on: !p.auto }),
          }, `Auto-replant: ${p.auto ? 'On' : 'Off'}`)))));
  }
}

function fmtLeft(ms) {
  const m = Math.ceil(Math.max(0, ms) / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

function run(type, payload) {
  try {
    app.game.dispatch(type, payload);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

function overlay(title, ...content) {
  const close = () => back.remove();
  const back = el('div.sheet-backdrop.mb-picker-backdrop', { onclick: (e) => e.target === back && close() },
    el('div.sheet', { role: 'dialog', 'aria-modal': 'true' },
      el('h2', {}, title), ...content,
      el('button.btn.wide', { type: 'button', onclick: close }, 'Cancel')));
  document.body.append(back);
  return close;
}

function seedPicker(plot) {
  const seeds = seedList(state(), data());
  if (!seeds.length) {
    const close = overlay('No seeds',
      el('p', {}, 'You have no seeds. Seeds are sold in the Mossbrook market.'),
      el('button.btn.wide', { type: 'button', onclick: () => { close(); openMossbrook(app, 'market', 'buy'); } }, 'Open the Mossbrook market'));
    return;
  }
  const close = overlay('Plant a seed', el('div.gd-seed-list', {}, seeds.map((sd) =>
    el('button.recipe', {
      type: 'button',
      onclick: () => { if (run('garden/plant', { plot, seed: sd.id })) close(); },
    },
    itemIcon(sd.id, 32, sd.item.name),
    el('div.recipe-body', {},
      el('div.recipe-name', {}, sd.item.name),
      el('div.small.muted', {}, `Grows in ${fmtLeft(sd.minutes * 60000 / data().balance.garden.growSpeed)}, makes ${Array.isArray(sd.yield) ? (sd.yield[0] === sd.yield[1] ? sd.yield[0] : `${sd.yield[0]} to ${sd.yield[1]}`) : sd.yield} ${itemName(sd.crop)}`)),
    el('b', {}, `x${sd.count.toLocaleString()}`)))));
}

function confirmClear(p) {
  const close = overlay('Dig up this plot?',
    el('p', {}, `The ${itemName(p.seed)} comes back to your bag, but the growing so far is lost.`),
    el('button.btn.wide', { type: 'button', onclick: () => { if (run('garden/clear', { plot: p.index })) close(); } }, 'Yes, dig it up'));
}

function hints(check) {
  const out = [];
  if (check.needsBlueprint) {
    out.push(el('button.btn.wide', { type: 'button', onclick: () => openMossbrook(app, 'market', 'buy') }, 'Buy blueprints in Mossbrook'));
  }
  return out;
}

function costBlock(check, s) {
  const c = check.cost;
  const rows = [];
  for (const [item, need] of Object.entries(c.items)) {
    rows.push(costRow(itemIcon(item, 24, itemName(item)), itemName(item), itemCount(s, item), need));
  }
  if (c.coins > 0) rows.push(costRow(el('img.px.hs-coin', { src: 'assets/ui/coin.png', alt: '' }), 'Coins', s.coins, c.coins));
  if (c.blueprint) {
    const has = itemCount(s, c.blueprint) >= 1;
    rows.push(el(has ? 'div.hs-cost' : 'div.hs-cost.short', {},
      itemIcon(c.blueprint, 24, itemName(c.blueprint)),
      el('span.grow', {}, itemName(c.blueprint)),
      el('b', {}, has ? '✓' : '✗')));
  }
  return el('div.hs-costs', {}, el('h3', {}, 'Cost'), rows);
}

function costRow(icon, name, have, need) {
  return el(have < need ? 'div.hs-cost.short' : 'div.hs-cost', {},
    icon, el('span.grow', {}, name),
    el('b', {}, `${have.toLocaleString()} / ${need.toLocaleString()}`));
}

function upgrade(def) {
  try {
    app.game.dispatch('buildings/upgrade', { building: def.id });
  } catch (err) {
    toast(err.message);
    return;
  }
  const tier = buildingTier(state(), def.id);
  const look = lookName(data(), def.id, tier);
  toast(tier === 1
    ? `Your ${def.name} is built: ${look}!`
    : `Your ${def.name} is now ${/^[aeiou]/i.test(look) ? 'an' : 'a'} ${look}!`);
}

// Re-render the Garden sheet when a plot changes, or at every 5% of growth (not on every tick).
function gardenKey(s) {
  const d = data();
  const plots = plotList(s, d).map((p) => `${p.seed}:${p.auto}:${p.growMs ? Math.floor((p.ms / p.growMs) * 20) : 0}`).join(',');
  return `${plots}|${seedList(s, d).map((x) => `${x.id}${x.count}`).join(',')}`;
}
