// The story journal (docs/design.md "Story frame"): entries from data/story.json unlock when their
// `when` condition holds (the same condition kinds as achievements) and stay unlocked. They are
// checked after every command and at the end of every advance, so offline play unlocks them too.
// state.story = { got: { entryId: true }, seen: { entryId: true } } (docs/architecture.md "Phase 9").
import { conditionProgress } from './achievements.js';

export const id = 'story';

export function init(state, ctx) {
  settle(state, { ...ctx, emit: null }); // a migrated save gets its entries quietly (still unread)
}

const entries = (data) => data.story?.entries || [];

function settle(state, ctx) {
  const got = state.story.got;
  for (const e of entries(ctx.data)) {
    if (got[e.id]) continue;
    const p = conditionProgress(state, ctx.data, e.when);
    if (p.have < p.need) continue;
    got[e.id] = true;
    ctx.emit?.({ type: 'story', entry: e.id });
  }
}

export function advance(state, _ms, ctx) {
  settle(state, ctx);
}

export function afterCommand(state, ctx) {
  settle(state, ctx);
}

// ---- selectors ----

// Unlocked entries in data order: [{ ...entry, seen }].
export function storyList(state, data) {
  return entries(data).filter((e) => state.story.got[e.id]).map((e) => ({ ...e, seen: !!state.story.seen[e.id] }));
}

// Journal badge: an unlocked entry the player hasn't read.
export function storyNotice(state) {
  const { got, seen } = state.story;
  return Object.keys(got).some((id) => !seen[id]);
}

// The scene text for a finished project ({ title, lines }), or null.
export function sceneFor(data, projectId) {
  return data.story?.scenes?.[projectId] || null;
}

export const commands = {
  // entry: one entry id; none = mark every unlocked entry read.
  'story/seen': (state, { entry = null }) => {
    const { got, seen } = state.story;
    if (entry) {
      if (got[entry]) seen[entry] = true;
      return;
    }
    for (const id of Object.keys(got)) seen[id] = true;
  },
};
