// Sprite manager: loads the packed atlas and builds animated actors for cast roles.
// Which sprite plays which role lives in data/sprites.json (the art casting); the atlas is built
// from it by tools/atlas/pack.ps1. Frame names in the atlas: "<role>/<anim>_<dir>/<i>" for
// directional animations, "<role>/<anim>/<i>" otherwise, and "<role>/face" for portraits.
// Animation names in the atlas match those keys without the "/<i>".
import { AnimatedSprite, Assets, Container, Texture } from '../../lib/pixi.mjs';

// Loads the atlas named in sprites.json. Returns a bank that answers questions about roles.
export async function loadSprites(spritesData) {
  const sheet = await Assets.load(spritesData.atlas);
  const anims = sheet.animations || {};
  const dirs = spritesData.directions;

  function role(roleId) {
    return spritesData.roles[roleId] || null;
  }
  function layout(roleId) {
    const r = role(roleId);
    return r ? spritesData.layouts[r.layout] : null;
  }
  function key(roleId, anim, dir) {
    const spec = layout(roleId)?.anims[anim];
    if (!spec) return null;
    return spec.dirs ? `${roleId}/${anim}_${dir}` : `${roleId}/${anim}`;
  }

  return {
    directions: dirs,
    // True when the role was cast and packed into the atlas.
    has(roleId) {
      const k = key(roleId, 'idle', dirs[0]);
      return !!(k && anims[k]);
    },
    // Animation names the role's layout defines (whether or not every one was packed).
    animNames(roleId) {
      return Object.keys(layout(roleId)?.anims || {});
    },
    // Textures for one animation, or null if it isn't in the atlas.
    textures(roleId, anim, dir = dirs[0]) {
      const k = key(roleId, anim, dir);
      return (k && anims[k]) || null;
    },
    // Animation timing from the layout.
    timing(roleId, anim) {
      const spec = layout(roleId)?.anims[anim];
      return spec ? { fps: spec.fps, loop: spec.loop !== false } : { fps: 1, loop: true };
    },
    // A role may override its layout's anchor (held tools use a per-tool grip point).
    anchor(roleId) {
      return role(roleId)?.anchor || layout(roleId)?.anchor || [0.5, 1];
    },
    // One frame of a non-directional animation (item icons, held tools, props), or null.
    texture(roleId, anim = 'idle', i = 0) {
      return sheet.textures[`${roleId}/${anim}/${i}`] || null;
    },
    // Portrait texture (the pack's Faceset), or null.
    face(roleId) {
      return sheet.textures[`${roleId}/face`] || null;
    },
  };
}

// An animated actor for one role. view is a Container positioned at the actor's feet.
// The actor never advances by itself: call update(ticker) from the scene's own ticker, so a
// stopped scene (hidden tab) stops animating too.
export function createActor(bank, roleId, { anim = 'idle', dir } = {}) {
  const view = new Container();
  const startDir = dir || bank.directions[0];
  const first = bank.textures(roleId, anim, startDir) || bank.textures(roleId, 'idle', startDir);
  const sprite = new AnimatedSprite({ textures: first || [Texture.WHITE], autoUpdate: false });
  const [ax, ay] = bank.anchor(roleId);
  sprite.anchor.set(ax, ay);
  if (!first) sprite.tint = 0xff00ff; // uncast role: a visible placeholder square
  view.addChild(sprite);

  let curAnim = null;
  let curDir = null;

  function play(nextAnim, nextDir = curDir || startDir) {
    if (nextAnim === curAnim && nextDir === curDir) return;
    const tex = bank.textures(roleId, nextAnim, nextDir);
    if (!tex) return; // unknown animation for this role: keep what's playing
    const { fps, loop } = bank.timing(roleId, nextAnim);
    curAnim = nextAnim;
    curDir = nextDir;
    sprite.textures = tex;
    sprite.animationSpeed = fps / 60; // AnimatedSprite counts in 60ths of a second
    sprite.loop = loop;
    sprite.gotoAndPlay(0);
  }
  play(anim, startDir);

  return {
    roleId,
    view,
    sprite,
    play,
    get anim() { return curAnim; },
    get dir() { return curDir; },
    update(ticker) { sprite.update(ticker); },
    destroy() { view.destroy({ children: true }); },
  };
}
