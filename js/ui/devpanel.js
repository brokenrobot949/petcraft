// Test mode panel (hidden; toggled by tapping the version line in Journal five times).
// For testing only. Removed before release.
import { el, toast } from './dom.js';
import { petList } from '../systems/pets.js';
import { ended } from '../systems/sanctuary.js';

export function createDevPanel(app) {
  const { game } = app;
  const data = game.data;
  const run = (type, payload) => {
    try {
      game.dispatch(type, payload);
    } catch (err) {
      toast(err.message);
    }
  };

  const itemSel = el('select.field', { 'aria-label': 'Item' },
    Object.entries(data.items.items).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, it]) => el('option', { value: id }, it.name)));
  const qty = el('input.field', { type: 'number', value: '10', min: '1', inputMode: 'numeric', 'aria-label': 'Quantity' });
  const qualSelItem = el('select.field', { 'aria-label': 'Item quality' },
    data.tools.qualities.map((q) => el('option', { value: q.id }, q.name)));
  const skillSel = el('select.field', { 'aria-label': 'Skill' },
    data.skills.skills.map((s) => el('option', { value: s.id }, s.name)));
  const level = el('input.field', { type: 'number', value: '5', min: '1', max: String(data.balance.skills.maxLevel), inputMode: 'numeric', 'aria-label': 'Level' });

  const away = (label, ms) => el('button.btn', { type: 'button', onclick: () => app.simulateAway(ms) }, label);
  const H = 3600000;

  // ---- pets ----
  const archSel = el('select.field', { 'aria-label': 'Archetype' },
    data.pets.archetypes.map((a) => el('option', { value: a.id }, a.name)));
  const qualSel = el('select.field', { 'aria-label': 'Quality' },
    data.pets.qualities.map((q) => el('option', { value: q.id }, q.name)));
  const petSel = el('select.field', { 'aria-label': 'Pet' });
  const petNum = (label, value) => el('input.field', { type: 'number', value, min: '0', inputMode: 'numeric', 'aria-label': label });
  const energyIn = petNum('Energy', '100');
  const petLevelIn = petNum('Pet level', '5');
  const bondIn = petNum('Bond', '10');
  let petKey = null;
  const fillPets = () => {
    const pets = petList(game.getState());
    const key = pets.map((p) => `${p.id}:${p.name}`).join('|');
    if (key === petKey) return;
    petKey = key;
    const prev = petSel.value;
    petSel.replaceChildren(...pets.map((p) => el('option', { value: p.id }, p.name)));
    if (pets.some((p) => p.id === prev)) petSel.value = prev;
  };
  fillPets();
  // The panel is rebuilt each time it opens; drop the listener once this copy is gone.
  const off = game.subscribe(() => (petSel.isConnected ? fillPets() : off()));
  petSel.addEventListener('focus', fillPets);
  const petCmd = (type, extra) => () => run(type, { pet: petSel.value, ...extra() });

  // ---- buildings, renown, time of day ----
  const bldSel = el('select.field', { 'aria-label': 'Building' },
    data.buildings.buildings.map((b) => el('option', { value: b.id }, b.name)));
  const bldTier = el('select.field', { 'aria-label': 'Tier' },
    Array.from({ length: data.balance.buildings.maxTier + 1 }, (_, t) => el('option', { value: String(t) }, `Tier ${t}`)));
  const rankIn = el('input.field', { type: 'number', value: '2', min: '1', inputMode: 'numeric', 'aria-label': 'Renown rank' });
  // The polish layer lives with the scenes (PixiJS), so it loads only when used.
  const polish = (o) => import('../render/polish.js').then((m) => m.setPolishOverride(o)).catch((err) => toast(err.message));
  const hourSel = el('select.field', { 'aria-label': 'Time of day' },
    [['', 'Real clock'], ['6', 'Dawn'], ['13', 'Day'], ['19', 'Dusk'], ['23', 'Night']].map(([v, t]) => el('option', { value: v }, t)));
  const rainSel = el('select.field', { 'aria-label': 'Rain' },
    [['', 'Real weather'], ['1', 'Rain'], ['0', 'No rain']].map(([v, t]) => el('option', { value: v }, t)));
  const applyPolish = () => polish({
    hour: hourSel.value === '' ? null : Number(hourSel.value),
    rain: rainSel.value === '' ? null : rainSel.value === '1',
  });

  // ---- taming and treasure ----
  const encZone = el('select.field', { 'aria-label': 'Zone' },
    data.zones.zones.filter((z) => z.archetypes?.length).map((z) => el('option', { value: z.id }, z.name)));
  const encArch = el('select.field', { 'aria-label': 'Encounter archetype' },
    el('option', { value: '' }, 'Random species'), data.pets.archetypes.map((a) => el('option', { value: a.id }, a.name)));
  const encQual = el('select.field', { 'aria-label': 'Encounter quality' },
    el('option', { value: '' }, 'Random quality'), data.pets.qualities.map((q) => el('option', { value: q.id }, q.name)));
  // ---- Grand Projects, retirement, mastery, mythics ----
  const skillSel2 = skillSel.cloneNode(true);
  const archSel2 = archSel.cloneNode(true);
  const starsIn = el('input.field', { type: 'number', value: '10', min: '0', inputMode: 'numeric', 'aria-label': 'Mastery stars' });
  const finishAll = () => {
    for (let i = 0; i < 100 && !ended(game.getState(), data); i++) {
      try {
        game.dispatch('dev/finishStage', {});
      } catch (err) {
        toast(err.message);
        return;
      }
    }
  };
  const grantAll = (list) => () => { for (const [item, n] of list) run('dev/grant', { item, qty: n }); };

  return el('div.panel.dev-panel', {},
    el('h2', {}, 'Test mode'),
    el('p.small.muted', {}, 'For testing. Removed before release.'),
    el('h3', {}, 'Give items'),
    el('div.row', {}, itemSel),
    el('div.row', {}, qty, qualSelItem,
      el('button.btn', { type: 'button', onclick: () => run('dev/grant', { item: itemSel.value, qty: Number(qty.value), quality: qualSelItem.value }) }, 'Grant')),
    el('h3', {}, 'Set skill level'),
    el('div.row', {}, skillSel, level,
      el('button.btn', { type: 'button', onclick: () => run('dev/setLevel', { skill: skillSel.value, level: Number(level.value) }) }, 'Set')),
    el('h3', {}, 'Coins'),
    el('div.row', {},
      el('button.btn', { type: 'button', onclick: () => run('dev/addCoins', { amount: 100 }) }, '+100'),
      el('button.btn', { type: 'button', onclick: () => run('dev/addCoins', { amount: 1000 }) }, '+1000')),
    el('h3', {}, 'Buildings'),
    el('div.row', {}, bldSel, bldTier,
      el('button.btn', { type: 'button', onclick: () => run('dev/setBuilding', { building: bldSel.value, tier: Number(bldTier.value) }) }, 'Set')),
    el('button.btn.wide', {
      type: 'button',
      onclick: () => {
        const grants = [['blueprint_sturdy', 5], ['blueprint_fine', 5], ['blueprint_grand', 5]];
        for (const [item, q] of grants) run('dev/grant', { item, qty: q });
        run('dev/addCoins', { amount: 10000 });
      },
    }, 'Blueprints x5 each + 10000 coins'),
    el('div.row', {}, rankIn,
      el('button.btn', { type: 'button', onclick: () => run('dev/setRenown', { rank: Number(rankIn.value) }) }, 'Set Renown rank')),
    el('div.row', {},
      el('button.btn', { type: 'button', onclick: () => run('dev/addRenownXp', { amount: 100 }) }, '+100 Renown XP'),
      el('button.btn', { type: 'button', onclick: () => run('dev/newDay') }, 'New commissions')),
    el('h3', {}, 'Time of day and weather'),
    el('div.row', {}, hourSel, rainSel,
      el('button.btn', { type: 'button', onclick: applyPolish }, 'Apply')),
    el('h3', {}, 'Pets'),
    el('div.row', {}, archSel, qualSel,
      el('button.btn', { type: 'button', onclick: () => run('dev/addPet', { archetype: archSel.value, quality: qualSel.value }) }, 'Add pet')),
    el('div.row', {}, petSel),
    el('div.row', {}, energyIn,
      el('button.btn', { type: 'button', onclick: petCmd('dev/petEnergy', () => ({ energy: Number(energyIn.value) })) }, 'Set energy')),
    el('div.row', {}, petLevelIn,
      el('button.btn', { type: 'button', onclick: petCmd('dev/petLevel', () => ({ level: Number(petLevelIn.value) })) }, 'Set level')),
    el('div.row', {}, bondIn,
      el('button.btn', { type: 'button', onclick: petCmd('dev/petBond', () => ({ bond: Number(bondIn.value) })) }, 'Set Bond')),
    el('button.btn.wide', { type: 'button', onclick: petCmd('dev/clearPat', () => ({})) }, 'Allow another pat today'),
    el('div.row', {},
      el('button.btn', { type: 'button', onclick: petCmd('dev/petReadyToEvolve', () => ({})) }, 'Ready to evolve'),
      el('button.btn', { type: 'button', onclick: petCmd('dev/petCalling', () => ({})) }, 'Fill callings')),
    el('button.btn.wide', { type: 'button', onclick: () => run('dev/catalysts', {}) }, 'All catalysts'),
    el('h3', {}, 'Taming and treasure'),
    el('div.row', {}, encZone),
    el('div.row', {}, encArch, encQual),
    el('button.btn.wide', { type: 'button', onclick: () => run('dev/encounter', { zone: encZone.value, archetype: encArch.value || undefined, quality: encQual.value || undefined }) }, 'Make an encounter'),
    el('button.btn.wide', { type: 'button', onclick: () => run('dev/finishTimers') }, 'Finish traps, eggs and dig'),
    el('button.btn.wide', { type: 'button', onclick: grantAll([['pine_trap', 1], ['berry_bait', 1], ['nut_bait', 1], ['fish_bait', 1]]) }, 'Pine trap + 3 baits'),
    el('button.btn.wide', { type: 'button', onclick: grantAll([['map_meadowfold', 2]]) }, '2 Meadowfold maps'),
    el('button.btn.wide', { type: 'button', onclick: grantAll([['treasure_egg', 1]]) }, 'Treasure egg'),
    el('h3', {}, 'Grand Projects'),
    el('button.btn.wide', { type: 'button', onclick: () => run('dev/stageNeeds', {}) }, 'Give what this stage needs'),
    el('button.btn.wide', { type: 'button', onclick: () => run('dev/finishStage', {}) }, 'Finish this stage'),
    el('button.btn.wide', { type: 'button', onclick: finishAll }, 'Finish all projects'),
    el('h3', {}, 'Endgame'),
    el('button.btn.wide', { type: 'button', onclick: petCmd('dev/readyToRetire', () => ({})) }, 'Ready to retire'),
    el('div.row', {}, skillSel2, starsIn,
      el('button.btn', { type: 'button', onclick: () => run('dev/masteryStars', { skill: skillSel2.value, stars: Number(starsIn.value) }) }, 'Mastery stars')),
    el('div.row', {}, archSel2,
      el('button.btn', { type: 'button', onclick: () => run('dev/encounter', { zone: 'heartgrove', archetype: archSel2.value, mythic: true }) }, 'Mythic encounter')),
    el('button.btn.wide', { type: 'button', onclick: () => run('dev/endgameKit', {}) }, 'Endgame kit (Starmetal trap + mythic bait)'),
    el('h3', {}, 'Pretend I was away'),
    el('div.row', {}, away('10 min', 600000), away('1 h', H), away('8 h', 8 * H), away('20 h', 20 * H)),
    el('h3', {}, 'Start over'),
    el('button.btn.wide', {
      type: 'button',
      onclick: () => {
        if (confirm('Start a new game? Your current game is kept as a backup.')) app.resetGame();
      },
    }, 'Start a new game'));
}
