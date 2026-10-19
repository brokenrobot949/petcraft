// Player settings stored in the save (so they travel with an exported save code).
export const id = 'settings';

const TOGGLES = ['music', 'sound'];

export const commands = {
  'settings/toggle': (state, { key }) => {
    if (!TOGGLES.includes(key)) throw new Error(`unknown setting ${key}`);
    state.settings[key] = !state.settings[key];
  },
};
