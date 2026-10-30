// A pet's wish card and tricks panel on its page (Phase 12, docs/design.md "Pet life" 1 and 7). The card says
// what the pet wishes for and how to grant it, with a shortcut where there is one (feed the dish, play, teach)
// and "Let it go". The tricks panel lists learned tricks, teaches one lesson a day, and "Show me a trick"
// plays one on the portrait (CSS, css/pets.css .trick-*). The rules live in js/systems/pets.js and wishes.js.
import { el, toast } from './dom.js';
import { localDay } from '../core/time.js';
import { getPet, canPlayToday } from '../systems/pets.js';
import { wishText, trickInfo, trickDef } from '../systems/wishes.js';
import { parseKey, itemLabel } from '../systems/bag.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function act(game, type, payload) {
  try {
    game.dispatch(type, payload);
    return true;
  } catch (err) {
    toast(err.message);
    return false;
  }
}

// Words for a granted wish (an event from the last command), or ''.
function grantedLine(game, pet) {
  return fmt(pick(game.data.wishes.granted), { name: pet.name });
}

// The best bag key for a Taste wish (the plainest quality first), or null.
function wishedFood(st, item) {
  const keys = Object.keys(st.bag).filter((k) => st.bag[k] > 0 && parseKey(k).id === item);
  return keys.sort((a, b) => a.length - b.length)[0] || null;
}

// The wish card, or null when the pet has no wish. onPlay(): start a game; note(text, hearts): say something.
// live(fn): register a per-frame updater (progress bar).
export function wishCard(game, petId, { note, onPlay, live }) {
  const st = game.getState();
  const d = game.data;
  const pet = getPet(st, petId);
  const w = pet && wishText(st, d, pet);
  if (!w) return null;
  const buttons = [];
  if (pet.wish.kind === 'taste') {
    const key = wishedFood(st, pet.wish.item);
    buttons.push(key
      ? el('button.btn', {
        type: 'button',
        onclick: () => { if (act(game, 'pets/feed', { pet: petId, item: key })) note(grantedLine(game, pet), true); },
      }, `Feed ${itemLabel(d, key)}`)
      : el('button.btn.soft-off', { type: 'button', 'aria-disabled': 'true', onclick: () => toast(`Cook a ${itemLabel(d, pet.wish.item)} in the Kitchen first.`) }, 'Cook it first'));
  } else if (pet.wish.kind === 'play') {
    const ok = canPlayToday(st, petId, localDay(Date.now()));
    buttons.push(el(`button.btn${ok ? '' : '.soft-off'}`, {
      type: 'button',
      onclick: () => (ok ? onPlay() : toast(`${pet.name} already played today. Come back tomorrow!`)),
    }, 'Play now'));
  } else if (pet.wish.kind === 'toy') {
    const have = (st.bag[pet.wish.item] || 0) > 0;
    buttons.push(have
      ? el('button.btn', {
        type: 'button',
        onclick: () => { if (act(game, 'yard/place', { item: pet.wish.item })) note(grantedLine(game, pet), true); },
      }, 'Place it')
      : el('button.btn.soft-off', { type: 'button', 'aria-disabled': 'true', onclick: () => toast(`Make a ${itemLabel(d, pet.wish.item)} first (Craft tab).`) }, 'Make it first'));
  } else if (pet.wish.kind === 'trip') {
    buttons.push(el('button.btn', {
      type: 'button',
      onclick: () => document.getElementById(`trip-${petId}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }),
    }, 'Plan a trip'));
  } else if (pet.wish.kind === 'trick') {
    buttons.push(el('button.btn', {
      type: 'button',
      onclick: () => document.getElementById(`tricks-${petId}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }),
    }, 'Go to Tricks'));
  }
  buttons.push(el('button.btn', {
    type: 'button',
    onclick: () => { if (act(game, 'pets/letWishGo', { pet: petId })) note(`${pet.name} lets the wish go. Another will come.`, false); },
  }, 'Let it go'));
  let bar = null;
  if (w.progress != null) {
    const fill = el('div.fill', {});
    const text = el('span.small', {});
    live((s) => {
      const p = getPet(s, petId);
      const now = p && wishText(s, d, p);
      if (!now || now.progress == null) return;
      fill.style.width = `${Math.round(now.progress * 100)}%`;
      text.textContent = `${Math.floor(now.progress * 60)} of 60 minutes`;
    });
    bar = el('div', {}, el('div.bar', {}, fill), text);
  }
  return el('div.panel.pet-wish', {},
    el('h3.pet-sub-h', {}, el('span.pet-wish-dot', { 'aria-hidden': 'true' }), ' A wish'),
    el('p.pet-wish-line', {}, `"${w.line}"`),
    el('p.small', {}, w.need),
    bar,
    el('p.small.muted', {}, `Granting it gives +${d.balance.petLife.wishes.bond} Bond and a cheerful mood. A wish never runs out.`),
    el('div.pet-wish-row', {}, buttons));
}

// Plays a trick on a portrait element (a CSS animation on its picture).
export function playTrick(portrait, trickId) {
  if (!portrait) return;
  const cls = `trick-${trickId}`;
  portrait.classList.remove(...[...portrait.classList].filter((c) => c.startsWith('trick-')));
  void portrait.offsetWidth; // restart the animation
  portrait.classList.add(cls);
  setTimeout(() => portrait.classList.remove(cls), 1000);
}

// The tricks panel. portrait(): the page's portrait element now (the page is rebuilt after a command).
export function tricksPanel(game, petId, { note, portrait }) {
  const st = game.getState();
  const d = game.data;
  const pet = getPet(st, petId);
  const info = trickInfo(d, pet);
  const words = d.tricks.lines;
  const today = localDay(Date.now());
  const taughtToday = pet.teachDay === today;
  const teach = (trickId) => {
    if (!act(game, 'pets/teach', { pet: petId, trick: trickId })) return;
    const after = getPet(game.getState(), petId);
    const name = trickDef(d, trickId)?.name || trickId;
    const learned = (after?.tricks[trickId] || 0) >= info.sessions;
    note(fmt(pick(learned ? words.learned : words.taught), { name: pet.name, trick: name }), learned);
    playTrick(portrait(), trickId);
  };
  const kids = [];
  kids.push(info.learned.length
    ? el('div.pet-trick-list', {}, info.learned.map((t) => el('span.pet-trick-chip.small', {}, t.name)))
    : el('p.small.muted', {}, 'No tricks yet.'));
  if (info.learned.length) {
    kids.push(el('button.btn.wide', {
      type: 'button',
      onclick: () => {
        const t = pick(info.learned);
        note(fmt(pick(words.show), { name: pet.name, trick: t.name }), false);
        playTrick(portrait(), t.id);
      },
    }, 'Show me a trick'));
  }
  if (info.current) {
    const { def, n } = info.current;
    kids.push(el('p.small', {}, `Learning ${def.name}: lesson ${n} of ${info.sessions}. ${def.blurb}`));
    kids.push(el(`button.btn.wide${taughtToday ? '.soft-off' : ''}`, {
      type: 'button',
      onclick: () => (taughtToday ? toast(`${pet.name} already had a lesson today. Come back tomorrow!`) : teach(def.id)),
    }, taughtToday ? 'Lesson done for today' : `Teach ${def.name}`));
  } else if (info.canStart) {
    kids.push(el('p.small', {}, taughtToday ? `${pet.name} had a lesson today. Pick the next trick tomorrow.` : 'Pick a trick to start teaching:'));
    if (!taughtToday) {
      kids.push(el('div.pet-trick-pick', {}, info.choices.map((t) => el('button.btn', {
        type: 'button',
        'aria-label': `Teach ${t.name}: ${t.blurb}`,
        onclick: () => teach(t.id),
      }, t.name))));
    }
  } else if (info.choices.length) {
    kids.push(el('p.small.muted', {}, `${pet.name} can learn another trick at the next Bond heart.`));
  } else {
    kids.push(el('p.small.muted', {}, `${pet.name} knows every trick!`));
  }
  kids.push(el('p.small.muted', {}, `One lesson a day; ${info.sessions} lessons learn a trick. Each Bond heart lets ${pet.name} learn one more (${info.learned.length + (info.current ? 1 : 0)} of ${info.slots} used).`));
  return el('div.panel', { id: `tricks-${petId}` }, el('h2', {}, 'Tricks'), ...kids);
}
