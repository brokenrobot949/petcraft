// Two more play games (Phase 12, docs/design.md "Pet life" 2): Leaf catch and Peekaboo. Like Fetch
// (js/ui/petplay.js) they run here in the UI and end with a result ('okay' | 'good' | 'perfect') that goes to
// the pets system with 'pets/play'. They can't be failed. Numbers from balance.petLife.leaf / .peekaboo, words
// from pets.json lines.leaf / lines.peekaboo. Stop closes the game and sends nothing.
import { el } from './dom.js';
import { faceIcon, frameIcon } from './icons.js';
import { getPet } from '../systems/pets.js';
import { petRole } from '../systems/petstats.js';

const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// The shared frame: title, help line, the play field, a count line and a result line, and Stop.
function overlay(words, pet, field) {
  const count = el('p.small', {}, '');
  const result = el('div.focus-result', {}, ' ');
  const node = el('div.focus-overlay', {}, el('div.focus-box.fetch-box', {},
    el('h2', {}, words.title),
    el('p', {}, fmt(words.help, { name: pet.name })),
    field,
    count,
    result,
    el('button.btn.wide', { type: 'button', onclick: () => api.stop() }, 'Stop')));
  const api = {
    node, count,
    say(text, kind) { result.textContent = text; result.className = `focus-result ${kind}`; },
    stop: () => {},
  };
  return api;
}

const resultFor = (n, cfg) => (n >= cfg.perfectAt ? 'perfect' : n >= cfg.goodAt ? 'good' : 'okay');

// ---- Leaf catch: leaves drift down; tap each before it lands ----
export function leafGame(game, petId, done) {
  const cfg = game.data.balance.petLife.leaf;
  const words = game.data.pets.lines.leaf;
  const pet = getPet(game.getState(), petId);
  if (!pet) return;
  const field = el('div.fetch-field.leaf-field', {},
    el('div.fetch-pet', {}, faceIcon(petRole(pet), 48, pet.name)));
  const ui = overlay(words, pet, field);
  const leaves = []; // { node, x, born, done }
  let spawned = 0;
  let caught = 0;
  let over = false;
  let raf = 0;
  let t0 = performance.now();
  let nextAt = 0;

  function count() { ui.count.textContent = `Caught ${caught} of ${cfg.leaves}`; }

  function spawn(now) {
    spawned += 1;
    const leaf = { x: 8 + Math.random() * 84, born: now, done: false, node: null };
    leaf.node = el('button.leaf', {
      type: 'button',
      'aria-label': 'Catch the leaf',
      style: `left:${leaf.x}%`,
      onpointerdown: (e) => { e.preventDefault(); catchLeaf(leaf); },
      onclick: () => catchLeaf(leaf), // keyboard
    }, frameIcon(`fx.leaf/idle/${Math.floor(Math.random() * 6)}`, 36, 'leaf'));
    field.append(leaf.node);
    leaves.push(leaf);
  }

  function catchLeaf(leaf) {
    if (over || leaf.done) return;
    leaf.done = true;
    caught += 1;
    leaf.node.classList.add('caught');
    setTimeout(() => leaf.node.remove(), 300);
    ui.say(words.caught, 'good');
    count();
  }

  function frame(now) {
    if (over) return;
    if (spawned < cfg.leaves && now - t0 >= nextAt) { spawn(now); nextAt += cfg.spawnMs; }
    for (const leaf of leaves) {
      if (leaf.done) continue;
      const p = (now - leaf.born) / cfg.fallMs;
      if (p >= 1) {
        leaf.done = true;
        leaf.node.remove();
        ui.say(words.missed, 'miss');
        continue;
      }
      leaf.node.style.top = `${p * 100}%`;
      leaf.node.style.marginLeft = `${Math.sin(p * Math.PI * 3) * 14}px`;
    }
    if (spawned >= cfg.leaves && leaves.every((l) => l.done)) {
      finish();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function close() {
    over = true;
    cancelAnimationFrame(raf);
    ui.node.remove();
  }
  function finish() {
    over = true;
    setTimeout(() => { ui.node.remove(); done(resultFor(caught, cfg)); }, 500);
  }
  ui.stop = close;
  count();
  document.body.append(ui.node);
  t0 = performance.now();
  raf = requestAnimationFrame(frame);
}

// ---- Peekaboo: the pet hides behind one of the bushes; tap the one that wiggles ----
export function peekabooGame(game, petId, done) {
  const cfg = game.data.balance.petLife.peekaboo;
  const words = game.data.pets.lines.peekaboo;
  const pet = getPet(game.getState(), petId);
  if (!pet) return;
  const bushes = [];
  const row = el('div.peek-row', { style: `grid-template-columns:repeat(${cfg.bushes}, minmax(0, 1fr))` });
  for (let i = 0; i < cfg.bushes; i++) {
    const face = el('span.peek-face', {}, faceIcon(petRole(pet), 32, pet.name));
    const b = el('button.peek-bush', { type: 'button', 'aria-label': `Bush ${i + 1}`, onclick: () => tap(i) },
      face, frameIcon('prop.bush/idle/0', 48, 'bush'));
    bushes.push(b);
    row.append(b);
  }
  const ui = overlay(words, pet, el('div.fetch-field.peek-field', {}, row));
  let round = 0;
  let found = 0;
  let hidden = -1; // the wiggling bush, or -1 between rounds
  let over = false;
  let timer = 0;

  function count() { ui.count.textContent = `Round ${Math.min(round, cfg.rounds)} of ${cfg.rounds}, found ${found}`; }

  function next() {
    if (over) return;
    for (const b of bushes) b.classList.remove('wiggle', 'peek');
    if (round >= cfg.rounds) { finish(); return; }
    round += 1;
    count();
    timer = setTimeout(() => {
      if (over) return;
      hidden = Math.floor(Math.random() * cfg.bushes);
      bushes[hidden].classList.add('wiggle');
      timer = setTimeout(() => endRound('late'), cfg.showMs);
    }, cfg.pauseMs + Math.random() * cfg.pauseMs);
  }

  function tap(i) {
    if (over || hidden < 0) return;
    endRound(i === hidden ? 'found' : 'missed');
  }

  function endRound(kind) {
    clearTimeout(timer);
    const was = hidden;
    hidden = -1;
    if (kind === 'found') found += 1;
    bushes[was]?.classList.remove('wiggle');
    bushes[was]?.classList.add('peek');
    ui.say(fmt(words[kind], { name: pet.name }), kind === 'found' ? 'good' : 'miss');
    count();
    timer = setTimeout(next, cfg.pauseMs * 2);
  }

  function close() {
    over = true;
    clearTimeout(timer);
    ui.node.remove();
  }
  function finish() {
    over = true;
    setTimeout(() => { ui.node.remove(); done(resultFor(found, cfg)); }, 300);
  }
  ui.stop = close;
  document.body.append(ui.node);
  next();
}
