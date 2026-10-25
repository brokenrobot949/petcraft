// Pet names: a random name for the name fields (hatching, the Nest, renaming a pet) and the
// rename sheet, shared by the Pets and World tabs. Names are a UI choice, so Math.random is fine here.
import { el, toast, sheet } from './dom.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Sometimes a name from pets.json suggestedNames, otherwise one made of two nameParts
// ("Bram" + "kin"). Never the same as `current`, never longer than the name limit.
export function randomName(data, current = '') {
  const { suggestedNames, nameParts } = data.pets;
  const max = data.balance.pets.nameMaxLength;
  const same = (n) => n.toLowerCase() === String(current).trim().toLowerCase();
  if (Math.random() >= data.balance.pets.randomNameListChance) {
    const made = pick(nameParts.starts) + pick(nameParts.ends);
    if (made.length <= max && !same(made) && !suggestedNames.some((n) => n === made)) return made;
  }
  const choices = suggestedNames.filter((n) => !same(n));
  return pick(choices.length ? choices : suggestedNames);
}

// The "Random name" button under a name field.
export function randomNameButton(data, input) {
  return el('button.btn.wide', {
    type: 'button',
    onclick: () => { input.value = randomName(data, input.value); input.focus(); },
  }, 'Random name');
}

// Rename a pet. `title` and `start` let a just-caught pet open as "Name your ..." with a random name.
export function renameSheet(game, pet, { title = `Rename ${pet.name}`, start = pet.name } = {}) {
  const d = game.data;
  const input = el('input.field.pet-name-input', {
    type: 'text', maxLength: d.balance.pets.nameMaxLength, autocomplete: 'off', enterKeyHint: 'done', value: start, 'aria-label': 'New name',
  });
  let close = () => {};
  const save = () => {
    try {
      game.dispatch('pets/rename', { pet: pet.id, name: input.value });
    } catch (err) {
      toast(err.message);
      return;
    }
    close();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  close = sheet(title, input, randomNameButton(d, input), el('button.btn.wide', { type: 'button', onclick: save }, 'Save name'));
  input.focus();
  input.select();
}
