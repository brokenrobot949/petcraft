// Bookkeeping about the save itself.
export const id = 'meta';

export const commands = {
  // Sent once per page load, after offline catch-up.
  'meta/launched': (state) => {
    state.meta.launches += 1;
  },
};
