// The Grand Projects sheet: restoring the Old Sanctuary (Phase 9). Reads state, sends commands.
import { el, toast } from './dom.js';
import { itemIcon } from './icons.js';
import { openSheet, closeSheet } from './layer.js';
import { projectList, currentStage, sanctuaryOpen, ended, rewardText } from '../systems/sanctuary.js';

export function openSanctuary(app) {
  const { game } = app;
  const data = () => game.data;
  const state = () => game.getState();
  const itemName = (id) => data().items.items[id]?.name || id;
  const skillName = (id) => data().skills.skills.find((s) => s.id === id)?.name || id;
  const rewards = (def) => (def.reward || []).map((r) => rewardText(data(), r)).filter(Boolean);

  const key = () => {
    const s = state();
    const d = data();
    const st = currentStage(s, d);
    const parts = [sanctuaryOpen(s, d) ? 1 : 0, s.sanctuary.project, s.sanctuary.stage, ended(s, d) ? 1 : 0];
    if (st) for (const n of st.needs) parts.push(`${n.item}:${n.have}:${n.bag}`);
    else parts.push(s.renown.rank);
    return parts.join('/');
  };

  const deliver = (payload) => {
    try {
      game.dispatch('sanctuary/deliver', payload);
    } catch (err) {
      toast(err.message);
    }
  };

  openSheet(game, 'The Old Sanctuary', (body, foot) => {
    const s = state();
    const d = data();
    const openAt = d.balance.sanctuary.openRenown;

    if (!sanctuaryOpen(s, d)) {
      body.append(
        el('p', {}, 'Next to your plot stand the ruins of the Old Sanctuary, where people and monsters once lived together. Five Grand Projects will bring it back to life.'),
        el('p', {}, `Rebuilding it is the biggest project in the game. It opens at Renown ${openAt}. You are Renown ${s.renown.rank} now.`),
        el('p.small.muted', {}, 'Keep harvesting, crafting and growing your homestead. When the time comes, the Sanctuary will be ready for you.'));
      projectsBlock(body, s, d);
      return;
    }

    if (ended(s, d)) {
      body.append(
        el('p.sa-finished', {}, 'The Old Sanctuary is whole again.'),
        el('p', {}, 'Every project is finished. The ruins are a home now, full of light, life and quiet happy noise. Thank you for taking such good care of it.'),
        el('p', {}, 'The Heartgrove is open on the World tab. The old guardians are waiting there.'));
      projectsBlock(body, s, d);
      return;
    }

    const st = currentStage(s, d);
    const def = st.project;
    body.append(
      el('p.hs-look', {}, def.name),
      el('p', {}, def.blurb),
      (def.leans?.length ? el('p.small.muted', {}, `Leans on: ${def.leans.map(skillName).join(', ')}`) : el('span')),
      el('p.small', {}, 'Reward when finished: ', el('b', {}, rewards(def).join('. ') || 'a surprise')),
      el('h3', {}, `Stage ${st.stage + 1} of ${st.stages}: ${st.name}`));
    for (const n of st.needs) body.append(needRow(n));
    projectsBlock(body, s, d);

    const anyReady = st.needs.some((n) => n.have < n.need && n.bag > 0);
    foot.append(el('button.btn.wide.hs-upgrade', {
      type: 'button', disabled: !anyReady, onclick: () => deliver({}),
    }, 'Deliver everything I can'));
    if (!anyReady) foot.append(el('p.small.muted.hs-hint', {}, 'Nothing in your bag fits this stage yet.'));
  }, key);

  function needRow(n) {
    const isCoins = n.item === 'coins';
    const name = isCoins ? 'Coins' : itemName(n.item);
    const met = n.have >= n.need;
    const fill = el('div.fill');
    fill.style.width = `${Math.min(100, (n.have / n.need) * 100)}%`;
    return el(`div.sa-need${met ? '.met' : ''}`, {},
      el('div.sa-need-top', {},
        isCoins ? el('img.px.hs-coin', { src: 'assets/ui/coin.png', alt: '' }) : itemIcon(n.item, 24, name),
        el('span.grow', {}, name),
        el('b', {}, met ? '✓ Done' : `${n.have.toLocaleString()} / ${n.need.toLocaleString()}`)),
      el('div.bar', {}, fill),
      el('div.sa-need-bottom', {},
        el('span.small.muted', {}, `In your bag: ${n.bag.toLocaleString()}`),
        el('button.btn', {
          type: 'button',
          disabled: met || n.bag <= 0,
          'aria-label': `Deliver ${name}`,
          onclick: () => deliver({ item: n.item }),
        }, 'Deliver')));
  }

  function projectsBlock(body, s, d) {
    body.append(el('h3', {}, 'All projects'));
    for (const p of projectList(s, d)) {
      const mark = p.status === 'done' ? '✓' : p.status === 'current' ? '▶' : '○';
      body.append(el(`div.sa-project.${p.status}`, {},
        el('div.sa-project-top', {},
          el('span.sa-mark', { 'aria-hidden': 'true' }, mark),
          el('b', {}, p.name),
          el('span.small.muted', {}, p.status === 'done' ? 'Finished' : p.status === 'current' ? 'In progress' : 'Locked')),
        el('p.small.muted', {}, rewards(p).join('. '))));
    }
  }
}

export { closeSheet };
