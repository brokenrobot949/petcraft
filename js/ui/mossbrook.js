// The Mossbrook sheet: Commission Board, Market (Sell and Buy sub-tabs; Buy holds the shop and recipe scrolls)
// and the daily Merchant.
// The UI only reads state and selectors, and changes things with game.dispatch.
import { el, toast } from './dom.js';
import { getPref, setPref } from './device.js';
import { itemIcon } from './icons.js';
import { itemLabel } from '../systems/bag.js';
import {
  boardList, greatCommission, rerollInfo, sellList, shopList, scrollList, merchantList,
} from '../systems/village.js';
import { stationDef } from '../systems/crafting.js';

const TABS = [['board', 'Board'], ['market', 'Market'], ['merchant', 'Merchant']];
const SIDES = [['sell', 'Sell'], ['buy', 'Buy']]; // the Market's sub-tabs; the last pick is remembered per device

let current = null; // { backdrop, unsub, setTab }
let picker = null; // the open quantity picker overlay

export function closeMossbrook() {
  closePicker();
  if (!current) return;
  current.unsub();
  if (current.previousScene) current.audio?.setScene(current.previousScene);
  current.backdrop.remove();
  current = null;
}

function closePicker() {
  picker?.remove();
  picker = null;
}

// side ('sell' or 'buy') picks the Market sub-tab; left out, the Market opens where the player last left it.
export function openMossbrook(app, startTab = 'board', side = null) {
  if (current) {
    current.setTab(startTab, side);
    return;
  }
  const game = app.game;
  const data = game.data;
  const state = () => game.getState();
  const itemName = (id) => data.items.items[id]?.name || id;
  const coinImg = () => el('img.px.hs-coin', { src: 'assets/ui/coin.png', alt: 'coins' });
  const coins = (n) => el('span.mb-coins', {}, coinImg(), el('b', {}, n.toLocaleString()));

  const run = (type, payload) => {
    try {
      game.dispatch(type, payload);
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  };

  let tab = tabs().includes(startTab) ? startTab : 'board';
  function tabs() { return TABS.map((t) => t[0]); }
  const sides = SIDES.map((t) => t[0]);
  let marketSide = sides.includes(side) ? side : getPref('marketSide', 'sell');
  if (!sides.includes(marketSide)) marketSide = 'sell';

  const body = el('div.hs-body');
  const purse = el('b'); // the player's coins, always in view while shopping
  const segButtons = TABS.map(([id, name]) => el('button.mb-seg', {
    type: 'button', role: 'tab', 'data-tab': id, onclick: () => setTab(id),
  }, name));
  const seg = el('div.mb-segs', { role: 'tablist' }, segButtons);
  const sideButtons = SIDES.map(([id, name]) => el('button.subtab', {
    type: 'button', role: 'tab', 'data-side': id, onclick: () => setSide(id),
  }, name));
  const sideBar = el('div.subtabs.mb-sides', { role: 'tablist', 'aria-label': 'Market' }, sideButtons);
  const foot = el('div.hs-foot', {}, el('button.btn.wide', { type: 'button', onclick: closeMossbrook }, 'Close'));
  const backdrop = el('div.sheet-backdrop.home-sheet-backdrop', { onclick: (e) => e.target === backdrop && closeMossbrook() },
    el('div.sheet.home-sheet.mb-sheet', { role: 'dialog', 'aria-modal': 'true' },
      el('div.mb-head', {}, el('h2', {}, 'Mossbrook'), el('span.mb-purse', { 'aria-label': 'Your coins' }, coinImg(), purse)),
      seg, sideBar, body, foot));
  document.body.append(backdrop);

  let lastKey = null;
  function setTab(id, newSide = null) {
    if (!tabs().includes(id)) id = 'board';
    if (id !== tab) body.scrollTop = 0;
    tab = id;
    if (sides.includes(newSide)) setSide(newSide);
    lastKey = null;
    closePicker();
    render();
  }

  function setSide(id) {
    if (id !== marketSide) body.scrollTop = 0;
    marketSide = id;
    setPref('marketSide', id);
    lastKey = null;
    closePicker();
    render();
  }

  function keyFor() {
    const s = state();
    const d = data;
    const common = `${tab}|${s.coins}|${s.renown.rank}`;
    if (tab === 'board') return `${common}|${JSON.stringify([boardList(s, d), greatCommission(s, d), rerollInfo(s, d)])}`;
    if (tab === 'market' && marketSide === 'sell') return `${common}|sell|${JSON.stringify(sellList(s, d).map((e) => [e.key, e.count]))}`;
    if (tab === 'market') return `${common}|buy|${JSON.stringify([shopList(s, d).map((e) => e.have), scrollList(s, d).map((e) => e.known)])}`;
    return `${common}|${JSON.stringify(merchantList(s, data).map((m) => [m.index, m.left]))}`;
  }

  function render() {
    purse.textContent = state().coins.toLocaleString();
    for (const b of segButtons) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    sideBar.hidden = tab !== 'market';
    for (const b of sideButtons) b.setAttribute('aria-selected', String(b.dataset.side === marketSide));
    if (picker) return; // don't rebuild under an open quantity picker
    const key = keyFor();
    if (key === lastKey) return;
    lastKey = key;
    const scroll = body.scrollTop;
    body.replaceChildren(...(tab === 'board' ? boardView() : tab === 'market' ? (marketSide === 'sell' ? sellView() : buyView()) : merchantView()));
    body.scrollTop = scroll;
    if (tab === 'board' && !state().village.seen) run('village/seen');
  }

  // ---- Board ----

  function rewardLine(c) {
    const bits = [coins(c.coins), el('span.mb-reward', {}, `${c.renown} Renown XP`)];
    for (const [item, n] of Object.entries(c.bonus || {})) {
      bits.push(el('span.mb-reward', {}, itemIcon(item, 16, itemName(item)), ` ${n} ${itemName(item)}`));
    }
    return el('div.mb-rewards', {}, el('span.small.muted', {}, 'Reward:'), bits);
  }

  function commissionCard(c, { great = false, rerollBtn = null } = {}) {
    const items = c.items.map((i) => {
      const short = i.have < i.need;
      return el(short ? 'div.hs-cost.short' : 'div.hs-cost', {},
        itemIcon(i.item, 24, itemName(i.item)),
        el('span.grow', {}, itemName(i.item)),
        el('b', {}, `${Math.min(i.have, 999999).toLocaleString()} / ${i.need.toLocaleString()}`));
    });
    const actions = c.done
      ? [el('p.mb-done', {}, 'Delivered')]
      : [el('div.row.mb-actions', {},
        el('button.btn', { type: 'button', disabled: !c.canDeliver, onclick: () => deliver(c) }, 'Deliver'),
        rerollBtn)];
    return el('div.panel.mb-card' + (c.done ? '.done' : '') + (great ? '.great' : ''), {},
      el('h3', {}, great ? 'Great Commission - this week' : c.giver),
      great && el('p.small.muted', {}, c.giver),
      c.note && el('p.mb-note', {}, `"${c.note}"`),
      el('div.hs-costs', {}, items),
      rewardLine(c),
      actions);
  }

  function deliver(c) {
    if (run('village/deliver', { slot: c.slot })) toast(`Delivered! +${c.coins} coins`);
  }

  function boardView() {
    const s = state();
    const info = rerollInfo(s, data);
    const out = [el('h3.mb-h', {}, "Today's commissions")];
    for (const c of boardList(s, data)) {
      const rr = c.done ? null : el('button.btn', { type: 'button', onclick: () => run('village/reroll', { slot: c.slot }) },
        'Reroll: ', info.free > 0 ? 'free' : coins(info.cost));
      out.push(commissionCard(c, { rerollBtn: rr }));
    }
    out.push(el('p.small.muted', {}, info.free > 0
      ? `Reroll swaps a commission for a new one. You have ${info.free} free reroll${info.free === 1 ? '' : 's'} today.`
      : 'Reroll swaps a commission for a new one. Today\'s free reroll is used.'));
    out.push(el('p.small.muted', {}, 'New commissions arrive at midnight.'));
    const g = greatCommission(s, data);
    if (g) {
      out.push(el('h3.mb-h', {}, 'This week'));
      out.push(commissionCard(g, { great: true }));
    }
    return out;
  }

  // ---- Market ----

  function sellView() {
    const s = state();
    const out = [];
    const sell = sellList(s, data);
    if (!sell.length) out.push(el('p.small.muted', {}, 'Nothing in your bag that the market buys yet.'));
    for (const cat of data.items.categories) {
      const rows = sell.filter((e) => e.item.category === cat.id);
      if (!rows.length) continue;
      out.push(el('h4.mb-cat', {}, cat.name));
      for (const e of rows) {
        const name = itemLabel(data, e.key);
        out.push(el('button.hs-row.mb-row', { type: 'button', onclick: () => sellPicker(e) },
          itemIcon(e.key, 32, name),
          el('span.hs-row-main', {}, el('span.hs-row-name', {}, name), el('span.small.muted', {}, `You have ${e.count.toLocaleString()}`)),
          el('span.mb-price', {}, coins(e.price), el('span.small.muted', {}, 'each'))));
      }
    }

    return out;
  }

  function buyView() {
    const s = state();
    const out = [el('h3.mb-h', {}, 'Shop')];
    for (const e of shopList(s, data)) {
      const isSeed = !!e.def?.seed;
      out.push(el('button.hs-row.mb-row' + (e.locked ? '.locked' : ''), {
        type: 'button',
        onclick: () => (e.locked ? toast(e.locked) : isSeed ? buyPicker(e) : buyOne(e)),
      },
        itemIcon(e.item, 32, e.def?.name),
        el('span.hs-row-main', {},
          el('span.hs-row-name', {}, e.def?.name || e.item),
          el('span.small' + (e.locked ? '.mb-lock' : '.muted'), {}, e.locked || `You have ${e.have.toLocaleString()}`)),
        el('span.mb-price', {}, coins(e.price))));
    }

    out.push(el('h3.mb-h', {}, 'Recipe scrolls'));
    for (const e of scrollList(s, data)) {
      const station = e.def && stationDef(data, e.def.station);
      const outName = e.output?.name || e.recipe;
      const sub = `${station?.name || ''}, level ${e.def?.level || 1}`;
      out.push(el('div.hs-row.mb-row' + (e.locked ? '.locked' : ''), {},
        itemIcon(e.def?.output || e.recipe, 32, outName),
        el('span.hs-row-main', {},
          el('span.hs-row-name', {}, outName),
          el('span.small.muted', {}, sub),
          e.locked && !e.known && el('span.small.mb-lock', {}, e.locked)),
        e.known
          ? el('span.hs-chip', {}, 'Known')
          : el('span.mb-price', {}, coins(e.price),
            el('button.btn.mb-learn', { type: 'button', disabled: !!e.locked, onclick: () => learn(e) }, 'Learn'))));
    }
    return out;
  }

  function learn(e) {
    if (run('market/learn', { recipe: e.recipe })) toast(`You learned to make ${e.output?.name || 'it'}!`);
  }

  function buyOne(e) {
    if (run('market/buy', { item: e.item, qty: 1 })) toast(`Bought ${e.def?.name || e.item}`);
  }

  // A small bottom overlay with -1 / +1 / +10 / All and a total. confirm(qty) returns true on success.
  function quantityPicker({ title, icon, max, unit, verb, totalLabel, maxLabel, confirm }) {
    closePicker();
    let qty = 1;
    const total = el('div.mb-total');
    const qtyText = el('div.qty-num');
    const go = el('button.btn.wide', { type: 'button', onclick: () => { if (confirm(qty)) { closePicker(); lastKey = null; render(); } } }, verb);
    const step = (label, fn) => el('button.btn.qty-btn', { type: 'button', onclick: () => set(fn()) }, label);
    const set = (n) => {
      qty = Math.min(max(), Math.max(1, n));
      refresh();
    };
    function refresh() {
      if (max() < 1) { closePicker(); lastKey = null; render(); return; }
      qtyText.textContent = `${qty.toLocaleString()} x ${title}`;
      total.replaceChildren(totalLabel, ' ', coins(unit() * qty));
      go.disabled = false;
    }
    const overlay = el('div.sheet-backdrop.mb-picker-backdrop', { onclick: (e) => e.target === overlay && (closePicker(), (lastKey = null), render()) },
      el('div.sheet.mb-picker', { role: 'dialog', 'aria-modal': 'true' },
        el('div.qty-head', {}, icon, qtyText),
        el('div.row.qty-row', {}, step('-1', () => qty - 1), step('+1', () => qty + 1), step('+10', () => qty + 10), step(maxLabel, () => max())),
        total, go,
        el('button.btn.wide', { type: 'button', onclick: () => { closePicker(); lastKey = null; render(); } }, 'Cancel')));
    document.body.append(overlay);
    picker = overlay;
    refresh();
  }

  function sellPicker(e) {
    const name = itemLabel(data, e.key);
    quantityPicker({
      title: name,
      icon: itemIcon(e.key, 48, name),
      max: () => state().bag[e.key] || 0,
      unit: () => e.price,
      verb: 'Sell',
      totalLabel: 'You get',
      maxLabel: 'All',
      confirm: (qty) => {
        const ok = run('market/sell', { item: e.key, qty });
        if (ok) toast(`Sold ${qty} ${name} for ${(qty * e.price).toLocaleString()} coins`);
        return ok;
      },
    });
  }

  function buyPicker(e) {
    quantityPicker({
      title: e.def?.name || e.item,
      icon: itemIcon(e.item, 48, e.def?.name),
      max: () => Math.max(1, Math.floor(state().coins / e.price)),
      unit: () => e.price,
      verb: 'Buy',
      totalLabel: 'It costs',
      maxLabel: 'Max',
      confirm: (qty) => {
        const ok = run('market/buy', { item: e.item, qty });
        if (ok) toast(`Bought ${qty} ${e.def?.name || e.item}`);
        return ok;
      },
    });
  }

  // ---- Merchant ----

  function merchantView() {
    const list = merchantList(state(), data);
    const out = [el('h3.mb-h', {}, "Today's traveling merchant")];
    if (!list.length) out.push(el('p.small.muted', {}, 'The merchant has nothing for sale right now.'));
    for (const m of list) {
      const sold = m.left < 1;
      const cheaper = m.normal != null && m.normal > m.price;
      out.push(el('div.hs-row.mb-row' + (sold ? '.locked' : ''), {},
        itemIcon(m.item, 32, m.def?.name),
        el('span.hs-row-main', {},
          el('span.hs-row-name', {}, m.def?.name || m.item),
          el('span.small.muted', {}, sold ? 'Sold out' : `${m.left} left`)),
        el('span.mb-price', {},
          cheaper && el('s.small.muted', {}, m.normal.toLocaleString()),
          coins(m.price),
          el('button.btn.mb-learn', { type: 'button', disabled: sold, onclick: () => buyMerchant(m) }, 'Buy'))));
    }
    out.push(el('p.small.muted', {}, 'The merchant brings new goods every day at midnight.'));
    return out;
  }

  function buyMerchant(m) {
    if (run('market/buyMerchant', { index: m.index })) toast(`Bought ${m.def?.name || m.item}`);
  }

  const unsub = game.subscribe(render);
  const previousScene = app.audio?.getScene() || null;
  app.audio?.setScene('mossbrook');
  current = { backdrop, unsub, setTab, audio: app.audio, previousScene };
  render();
}
