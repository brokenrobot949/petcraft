// Home tab: the homestead scene on a PixiJS canvas, plus the building sheets (list and detail).
import { el, toast } from './dom.js';
import { itemIcon } from './icons.js';
import { itemCount } from '../systems/bag.js';
import { buildingList, buildingDef, buildingTier, tierCost, lookName, effectLines, upgradeCheck } from '../systems/buildings.js';

export const id = 'home';
export const label = 'Home';
export const icon = 'assets/ui/tab-home.png';
export const canvas = true;

let scene = null;
let visible = false;
let app = null;
let layer = null; // the open sheet: { backdrop, unsub }

export function mount(container, a) {
  app = a;
  container.append(el('button.btn.home-buildings-btn', { type: 'button', onclick: openList }, 'Buildings'));
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
    });
}

export function show() {
  visible = true;
  scene?.start();
}

export function hide() {
  visible = false;
  scene?.stop();
  closeLayer();
}

const data = () => app.game.data;
const state = () => app.game.getState();
const itemName = (itemId) => data().items.items[itemId]?.name || itemId;

function handleTap(target) {
  if (!target) return;
  if (target.kind === 'building') {
    openBuilding(target.id);
  } else if (target.kind === 'decor') {
    const label = data().buildings.decor?.find((d) => d.prop === target.prop)?.label;
    if (target.prop === 'signpost') toast('The road to Mossbrook opens in a later update.');
    else if (target.prop === 'sanctuary_ruins') toast(`The ${label || 'Old Sanctuary'}. Its restoration opens at Renown 12.`);
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

  if (check.cost) {
    body.append(effectBlock(`Next: ${lookName(d, def.id, check.next)}`, effectLines(s, d, def.id, check.next), nowLines));
    body.append(costBlock(check, s));
  } else {
    body.append(el('p.hs-done', {}, check.reason));
  }

  if (check.cost) {
    if (!check.ok) {
      foot.append(el('p.hs-reason', {}, check.reason));
      for (const h of hints(check, def, tier)) foot.append(el('p.small.muted.hs-hint', {}, h));
    }
    foot.append(el('button.btn.wide.hs-upgrade', {
      type: 'button',
      disabled: !check.ok,
      onclick: () => upgrade(def),
    }, tier === 0 ? `Build ${lookName(d, def.id, check.next)}` : `Upgrade to ${lookName(d, def.id, check.next)}`));
  }
}

function hints(check, def, tier) {
  const out = [];
  if (tier === 0 && state().renown.rank < (def.unlock?.renown || 1)) out.push('Renown ranks arrive with Mossbrook in a later update.');
  if (check.needsBlueprint) out.push('Blueprints are sold in the Mossbrook market, which opens in a later update.');
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
