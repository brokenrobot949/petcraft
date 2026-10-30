// Playing with pets (Phase 11): the Pat / Play / Tuck in buttons (on a pet's page and in the sheet that opens
// when a pet is tapped on Home) and the Fetch game. The game runs here in the UI; when it ends the result
// ('okay' | 'good' | 'perfect') goes to the pets system with 'pets/play', which gives the Bond and the mood.
// Numbers come from balance.petLife; words from pets.json lines.
import { el, toast } from './dom.js';
import { openSheet, closeSheet } from './layer.js';
import { faceIcon } from './icons.js';
import { localDay } from '../core/time.js';
import { getPet, canPatToday, canPlayToday, napInfo, petStatus } from '../systems/pets.js';
import { petRole, petHearts, petMaxEnergy, petSpecies } from '../systems/petstats.js';
import { leafGame, peekabooGame } from './petgames.js';
import { wishText } from '../systems/wishes.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Play picks one of the three games at random (Phase 12: Leaf catch and Peekaboo in js/ui/petgames.js).
const GAMES = [(...a) => fetchGame(...a), (...a) => leafGame(...a), (...a) => peekabooGame(...a)];

function act(game, type, payload) {
  try {
    game.dispatch(type, payload);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

// The mood line for a pet's page or sheet ("Playful: +5% work speed for 1 h 20 min"), or null.
export function moodText(data, pet) {
  if (!pet.mood) return null;
  const m = data.balance.petLife.moods[pet.mood.kind];
  if (!m) return null;
  const min = Math.max(1, Math.ceil(pet.mood.msLeft / 60000));
  const left = min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
  const name = pet.mood.kind.charAt(0).toUpperCase() + pet.mood.kind.slice(1);
  return `${name}: +${Math.round(m.speed * 100)}% work speed for ${left}`;
}

// Pat, Play and Tuck in buttons for one pet. note(text, hearts) shows what the pet did (hearts: float hearts).
export function playButtons(game, petId, note) {
  const data = game.data;
  const st = game.getState();
  const pet = getPet(st, petId);
  const day = localDay(Date.now());
  const lines = data.pets.lines;
  const patOk = canPatToday(st, petId, day);
  const playOk = canPlayToday(st, petId, day);
  const nap = napInfo(st, data, petId, day);
  return el('div.pet-play-row', {},
    el('button.btn.pet-pat', {
      type: 'button',
      disabled: !patOk,
      'aria-label': patOk ? `Pat ${pet.name}` : `${pet.name} was patted today`,
      onclick: () => {
        if (act(game, 'pets/pat', { pet: petId })) note(fmt(pick(lines.patted), { name: pet.name }), true);
      },
    }, patOk ? 'Pat' : 'Patted'),
    el('button.btn.pet-play', {
      type: 'button',
      disabled: !playOk,
      'aria-label': playOk ? `Play with ${pet.name}` : `${pet.name} played today`,
      onclick: () => startPlay(game, petId, note),
    }, playOk ? 'Play' : 'Played'),
    el(`button.btn.pet-nap${nap.can ? '' : '.soft-off'}`, {
      type: 'button',
      'aria-disabled': nap.can ? 'false' : 'true',
      'aria-label': pet.nap ? `${pet.name} is napping` : `Tuck ${pet.name} in for a nap`,
      onclick: () => {
        if (!nap.can) { toast(nap.reason); return; }
        if (act(game, 'pets/tuckIn', { pet: petId })) note(fmt(pick(lines.tuckedIn), { name: pet.name }), false);
      },
    }, pet.nap ? 'Napping' : 'Tuck in'));
}

// Plays one of the games, then sends the result (once a day; the system checks).
export function startPlay(game, petId, note) {
  const pet = getPet(game.getState(), petId);
  if (!pet) return;
  pick(GAMES)(game, petId, (result) => {
    if (act(game, 'pets/play', { pet: petId, result })) note(fmt(pick(game.data.pets.lines.played[result]), { name: pet.name }), true);
  });
}

// One line on what the buttons do (shown under them).
export function playHelp(data, pet) {
  const p = data.balance.petLife;
  const b = data.balance.pets.bond;
  return `A pat (+${b.pat} Bond) and a game (up to +${p.play.bond.perfect} Bond, then +${Math.round(p.moods[p.play.mood].speed * 100)}% work speed for ${Math.round(p.moods[p.play.mood].ms / 3600000)} h) once a day each. `
    + `Below ${Math.round(p.nap.maxEnergyFrac * 100)}% energy, tuck ${pet.name} in for a nap (rests ${p.nap.restMult}x faster).`;
}

// The sheet that opens when a pet is tapped on Home. openPage(petId) shows its full page.
export function openPetSheet(game, petId, openPage) {
  const data = game.data;
  const keyFn = () => {
    const st = game.getState();
    const pet = getPet(st, petId);
    if (!pet) return 'gone';
    const day = localDay(Date.now());
    return [pet.name, canPatToday(st, petId, day), canPlayToday(st, petId, day), napInfo(st, data, petId, day).can, !!pet.nap,
      pet.mood?.kind, Math.ceil((pet.mood?.msLeft || 0) / 60000), pet.wish?.kind, pet.wish?.line, petHearts(data, pet).hearts, Math.round(pet.energy), petStatus(st, petId)].join(':');
  };
  // A command redraws the sheet before the button's note callback runs, so the note goes straight into the
  // freshly built elements (and is kept for later redraws).
  let noteText = '';
  let noteEl = null;
  let portrait = null;
  const note = (text, withHearts) => {
    noteText = text;
    if (noteEl) noteEl.textContent = text;
    if (withHearts) floatHearts(portrait);
  };
  openSheet(game, getPet(game.getState(), petId)?.name || 'Your pet', (body, foot) => {
    const st = game.getState();
    const pet = getPet(st, petId);
    if (!pet) { body.append(el('p', {}, 'This pet is no longer here.')); return; }
    const h = petHearts(data, pet);
    const max = petMaxEnergy(data, pet);
    portrait = el('div.pet-portrait.pet-sheet-face', {}, faceIcon(petRole(pet), 64, pet.name));
    noteEl = el('p.pet-note', { 'aria-live': 'polite' }, noteText);
    const status = pet.nap ? 'Napping' : { resting: 'Resting', stabled: 'In the Stable', idle: 'Not working', working: 'Working', trip: 'Away on a day trip' }[petStatus(st, petId)];
    const mood = moodText(data, pet);
    const wish = wishText(st, data, pet);
    body.append(
      el('div.pet-sheet-head', {}, portrait,
        el('div', {},
          el('p.small.muted', {}, `${petSpecies(data, pet)} - Level ${pet.level}`),
          el('p.small', {}, `Bond: ${h.hearts} of ${h.max} hearts - Energy ${Math.round(pet.energy)} / ${Math.round(max)}`),
          el('p.small', {}, status),
          mood && el('p.small.pet-mood', {}, mood),
          wish && el('p.small.pet-wish-line', {}, `Wish: "${wish.line}"`))),
      noteEl,
      playButtons(game, petId, note),
      el('p.small.muted', {}, playHelp(data, pet)));
    foot.append(el('button.btn.wide', { type: 'button', onclick: () => { closeSheet(); openPage(petId); } }, `${pet.name}'s page`));
  }, keyFn);
}

// A few pixel hearts float up over a portrait.
const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
export function floatHearts(host) {
  if (!host) return;
  const count = reducedMotion() ? 1 : 5;
  for (let i = 0; i < count; i++) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 7 6');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('class', 'pet-float-heart');
    svg.setAttribute('aria-hidden', 'true');
    HEART.forEach((row, y) => [...row].forEach((c, x) => {
      if (c !== '#') return;
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1);
      svg.append(r);
    }));
    svg.style.left = `${20 + Math.random() * 60}%`;
    svg.style.animationDelay = `${i * 120}ms`;
    host.append(svg);
    setTimeout(() => svg.remove(), 1800 + i * 120);
  }
}

// ---- Fetch ----

// A few throws: the ball flies across the field and the player taps when it is over the pet. Each throw scores
// balance.petLife.fetch.points; the total picks the result (it can't fail: the lowest is 'okay').
// done(result) runs when the game ends; closing it early sends nothing (the pet can still play today).
export function fetchGame(game, petId, done) {
  const data = game.data;
  const f = data.balance.petLife.fetch;
  const words = data.pets.lines.fetch;
  const pet = getPet(game.getState(), petId);
  if (!pet) return;
  const ball = el('div.fetch-ball', { 'aria-hidden': 'true' });
  const face = el('div.fetch-pet', {}, faceIcon(petRole(pet), 48, pet.name));
  const field = el('div.fetch-field', { role: 'button', 'aria-label': 'Catch!', onclick: () => tap() },
    el('div.fetch-zone.good', { style: `width:${f.goodWidth * 100}%` }),
    el('div.fetch-zone.perfect', { style: `width:${f.perfectWidth * 100}%` }),
    face, ball);
  const count = el('p.small', {}, '');
  const result = el('div.focus-result', {}, ' ');
  let throwNo = 0;
  let points = 0;
  let t0 = 0;
  let pos = 0;
  let raf = 0;
  let flying = false;
  let over = false;
  let fromLeft = Math.random() < 0.5;

  const overlay = el('div.focus-overlay', {}, el('div.focus-box.fetch-box', {},
    el('h2', {}, words.title),
    el('p', {}, fmt(words.help, { name: pet.name })),
    field,
    count,
    result,
    el('button.btn.wide.focus-tap', { type: 'button', onclick: () => tap() }, 'Catch!'),
    el('button.btn.wide', { type: 'button', onclick: () => close() }, 'Stop')));

  function close() {
    over = true;
    cancelAnimationFrame(raf);
    overlay.remove();
  }

  function startThrow() {
    throwNo += 1;
    count.textContent = `Throw ${throwNo} of ${f.throws}`;
    fromLeft = !fromLeft;
    t0 = performance.now();
    flying = true;
    raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    if (over) return;
    const p = (now - t0) / f.sweepMs;
    if (p >= 1) { score('miss'); return; }
    pos = fromLeft ? p : 1 - p;
    ball.style.left = `${pos * 100}%`;
    ball.style.bottom = `${30 + Math.sin(p * Math.PI) * 45}%`; // a little arc
    raf = requestAnimationFrame(frame);
  }

  function tap() {
    if (!flying || over) return;
    cancelAnimationFrame(raf);
    const dist = Math.abs(pos - 0.5);
    score(dist <= f.perfectWidth / 2 ? 'perfect' : dist <= f.goodWidth / 2 ? 'good' : 'miss');
  }

  function score(kind) {
    flying = false;
    points += f.points[kind] || 0;
    result.textContent = words[kind];
    result.className = `focus-result ${kind}`;
    if (kind !== 'miss') {
      face.classList.remove('hop');
      void face.offsetWidth; // restart the hop animation
      face.classList.add('hop');
      ball.style.left = '50%';
      ball.style.bottom = '62%';
    }
    setTimeout(() => {
      if (over) return;
      if (throwNo < f.throws) { startThrow(); return; }
      const res = points >= f.perfectAt ? 'perfect' : points >= f.goodAt ? 'good' : 'okay';
      close();
      done(res);
    }, f.pauseMs);
  }

  document.body.append(overlay);
  startThrow();
}
