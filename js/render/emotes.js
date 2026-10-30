// Emote bubbles (Phase 11): a small speech bubble from the pack's Ui/Emote set pops up over a pet (or the
// player) when something happens to it: a heart for a pat or a new Bond heart, a star for a level, "Zzz" for a
// nap. Shared by the home and zone scenes. Read-only, like every scene: it only listens to live events.
// Bubbles are rationed (balance.render.emotes): one per character at a time, a short gap between them, and a
// few on screen at most, so a busy zone never fills with bubbles. Things the player did themself (a pat,
// play, feeding by hand) always show.
import { Sprite } from '../../lib/pixi.mjs';

const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

// Which bubble a live event shows, over whom: { id, kind, force } or null. kind = the role emote.<kind>.
export function emoteFor(e, data) {
  switch (e.type) {
    case 'petPat':
    case 'petPlayed':
    case 'petHeart':
    case 'favoriteFound':
      return { id: e.pet, kind: 'heart', force: true };
    case 'petAte':
      if (e.personal || e.favorite) return { id: e.pet, kind: 'heart', force: !e.auto };
      return e.auto ? null : { id: e.pet, kind: 'joy', force: true };
    case 'harvest': {
      if (e.rare) return { id: e.worker, kind: 'rare' };
      const map = Object.keys(e.items || {}).some((itemId) => data.items.items[itemId]?.category === 'map');
      return map ? { id: e.worker, kind: 'alert' } : null;
    }
    case 'petLevelUp':
    case 'talentReady':
      return { id: e.pet, kind: 'star' };
    case 'petEvolved':
      return { id: e.pet, kind: 'star', force: true };
    case 'petRest':
      return { id: e.pet, kind: 'tired' };
    case 'petNap':
      return { id: e.pet, kind: 'sleep', force: true };
    case 'petWoke':
      return e.napped ? { id: e.pet, kind: 'happy' } : null;
    case 'petGift':
      return { id: e.pet, kind: 'joy' };
    // Phase 12
    case 'petWish':
      return { id: e.pet, kind: 'thinking' };
    case 'wishGranted':
      return { id: e.pet, kind: 'heart', force: true };
    case 'petTaught':
      return { id: e.pet, kind: e.learned ? 'star' : 'happy', force: true };
    default:
      return null;
  }
}

// layer: the scene's effects container. cfg: balance.render.emotes.
export function createEmotes(layer, bank, cfg) {
  const live = new Map(); // id -> { sprite, age, target }
  const lastAt = new Map(); // id -> clock (ms) when its last bubble started
  let clock = 0;

  function remove(id) {
    const b = live.get(id);
    if (!b) return;
    b.sprite.destroy();
    live.delete(id);
  }

  // target(): { x, y (feet), head (screen px from the feet to the top of the head), scale } or null when gone.
  function show(id, kind, target, { force = false } = {}) {
    const tex = bank.texture(`emote.${kind}`);
    if (!tex || !target()) return;
    if (!force && (live.has(id) || clock - (lastAt.get(id) ?? -Infinity) < cfg.gapMs || live.size >= cfg.maxOnScreen)) return;
    remove(id);
    if (live.size >= cfg.maxOnScreen) remove(live.keys().next().value); // a forced one bumps the oldest
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5, 1);
    layer.addChild(sprite);
    live.set(id, { sprite, age: 0, target });
    lastAt.set(id, clock);
  }

  function update(ms) {
    clock += ms;
    for (const [id, b] of live) {
      const t = b.target();
      b.age += ms;
      if (!t || b.age >= cfg.showMs) { remove(id); continue; }
      const pop = Math.min(1, b.age / cfg.popMs);
      const s = t.scale * (pop < 1 ? Math.max(0.01, easeOutBack(pop)) : 1);
      b.sprite.scale.set(s);
      const bob = Math.sin((b.age / cfg.bobMs) * Math.PI * 2) * cfg.bobPx * t.scale;
      b.sprite.position.set(Math.round(t.x), Math.round(t.y - t.head - cfg.aboveHeadPx * t.scale + bob));
      const fadeFrom = cfg.showMs - cfg.fadeMs;
      b.sprite.alpha = b.age < fadeFrom ? 1 : 1 - (b.age - fadeFrom) / cfg.fadeMs;
    }
  }

  return {
    show,
    update,
    clear: remove,
    destroy() { for (const id of [...live.keys()]) remove(id); },
  };
}

// The target function for an actor (createActor) standing at agent.x / agent.y: follows it until it is gone.
export function actorTarget(agent, isGone) {
  return () => {
    if (isGone()) return null;
    const v = agent.actor.view;
    const sp = agent.actor.sprite;
    return { x: agent.x, y: agent.y, head: sp.texture.height * sp.anchor.y * v.scale.y, scale: v.scale.x / (agent.k || 1) };
  };
}
