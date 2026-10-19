// Zone scene (PixiJS): the strip of countryside at the top of a zone page. Draws the zone's harvest
// spots (tree, rock, bush, burrow, pond) and decor from data/zones.json "scene", puts the player at
// the spot for the current task and animates the work (wind-up and strike synced to the action
// progress), and floats "+N <item>" pops when the simulation reports a harvest.
// Read-only: it never changes game state. Every number comes from data.balance.render.zone and
// the zone's scene data. Render-only randomness uses Math.random (like homeScene).
// createZoneScene(host, game, zoneId) -> { start(), stop(), destroy() }. It is created and destroyed
// each time the zone page opens and closes, so destroy() must release everything.
import { Application, Container, Graphics, Sprite, Text, TextureSource } from '../../lib/pixi.mjs';
import { loadSprites, createActor } from './sprites.js';
import { actionMs, workerTask } from '../systems/harvest.js';

TextureSource.defaultOptions.scaleMode = 'nearest';

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeInOut = (t) => t * t * (3 - 2 * t);
const easeIn = (t) => t * t * t;

export async function createZoneScene(host, game, zoneId) {
  const data = game.data;
  const cfg = data.balance.render.zone;
  const zone = data.zones.zones.find((z) => z.id === zoneId);
  const scene = zone?.scene || { spots: {}, decor: [], idle: [0.5, 0.9] };
  const colorOf = (v) => Number(v); // balance.json stores colors as "0xrrggbb" strings

  const app = new Application();
  await app.init({
    resizeTo: host,
    background: colorOf(cfg.groundColor),
    antialias: false,
    roundPixels: true,
    resolution: Math.min(window.devicePixelRatio || 1, data.balance.render.maxResolution),
    autoDensity: true,
  });
  host.append(app.canvas);
  try { await document.fonts.load(`${cfg.popFontSize}px NormalFont`); } catch { /* fall back to the default font */ }

  const bank = await loadSprites(data.sprites);

  const ground = new Graphics();
  const world = new Container();
  world.sortableChildren = true;
  const fx = new Container();
  app.stage.addChild(ground, world, fx);

  let scale = cfg.pixelScale;
  let running = true;
  let destroyed = false;

  // ---- props: spots and decor, positioned in fractions of the scene ----
  const props = []; // { sprite, fx, fy }
  function addProp(roleId, fx, fy) {
    const tex = bank.texture(roleId);
    if (!tex) return null; // not cast yet: leave it out
    const sprite = new Sprite(tex);
    const [ax, ay] = bank.anchor(roleId);
    sprite.anchor.set(ax, ay);
    world.addChild(sprite);
    const p = { sprite, fx, fy };
    props.push(p);
    return p;
  }
  for (const spot of Object.values(scene.spots || {})) addProp(spot.prop, spot.x, spot.y);
  for (const d of scene.decor || []) addProp(d.prop, d.x, d.y);

  // ---- the player ----
  const player = createActor(bank, 'player', { anim: 'idle', dir: 'down' });
  world.addChild(player.view);
  const heldSprite = new Sprite();
  heldSprite.visible = false;
  player.view.addChild(heldSprite);
  let heldRole = null;

  const me = {
    x: 0, y: 0,
    mode: 'idle',       // 'idle' | 'walk' | 'work' | 'away'
    dir: 'down',
    target: null,       // { x, y, face } in screen px while walking
    spot: null,         // spot data while working
    bounceMs: cfg.bounceMs, // time since the last completed action
    placed: false,
  };

  function sizeNow() { return { w: app.screen.width, h: app.screen.height }; }
  const px = (fx, fy) => { const { w, h } = sizeNow(); return [Math.round(fx * w), Math.round(fy * h)]; };

  function drawGround() {
    const { w, h } = sizeNow();
    ground.clear();
    // Small darker grass flecks at fixed pseudo-random places (stable across resizes).
    const speck = colorOf(cfg.speckColor);
    for (let i = 0; i < cfg.specks; i++) {
      const rx = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const ry = (Math.sin(i * 78.233) * 12543.8721) % 1;
      const x = Math.floor(Math.abs(rx) * w / scale) * scale;
      const y = Math.floor(Math.abs(ry) * h / scale) * scale;
      ground.rect(x, y, scale * 2, scale).fill(speck);
      ground.rect(x + scale, y - scale, scale, scale).fill(speck);
    }
  }

  function layout() {
    const { w, h } = sizeNow();
    scale = (w >= cfg.wideMinWidthPx && h >= cfg.wideMinHeightPx) ? cfg.pixelScaleWide : cfg.pixelScale;
    drawGround();
    for (const p of props) {
      const [x, y] = px(p.fx, p.fy);
      p.sprite.scale.set(scale);
      p.sprite.position.set(x, y);
      p.sprite.zIndex = y;
    }
    player.view.scale.set(scale);
    // Re-aim the player at its (rescaled) place.
    if (me.mode === 'walk' && me.target) {
      const s = spotFor(workerTask(game.getState(), 'player'));
      if (s) me.target = standOf(s);
    } else if (me.mode === 'work' && me.spot) {
      const t = standOf(me.spot);
      me.x = t.x; me.y = t.y;
    } else if (me.mode === 'idle' || !me.placed) {
      const [x, y] = px(...scene.idle);
      me.x = x; me.y = y;
    }
    me.placed = true;
    placeView();
  }

  function standOf(spot) {
    const [x, y] = px(spot.stand[0], spot.stand[1]);
    return { x, y, face: spot.face };
  }
  function spotFor(task) {
    return task && task.zone === zoneId ? scene.spots?.[task.skill] || null : null;
  }

  function placeView() {
    player.view.position.set(Math.round(me.x), Math.round(me.y));
    player.view.zIndex = playerZ();
  }
  // While working, draw in front of the spot's prop so the held tool (a rod over the pond)
  // is never hidden behind it.
  function playerZ() {
    const front = me.mode === 'work' && me.spot ? px(me.spot.x, me.spot.y)[1] + 1 : 0;
    return Math.max(Math.round(me.y), front);
  }

  // ---- held tool ----
  function setHeld(kind) {
    const role = kind ? `held.${kind}` : null;
    if (role === heldRole) return;
    heldRole = role;
    const tex = role && bank.texture(role);
    if (!tex) { heldSprite.visible = false; heldRole = null; return; }
    heldSprite.texture = tex;
    const [ax, ay] = bank.anchor(role);
    heldSprite.anchor.set(ax, ay);
  }

  // ---- state -> behaviour ----
  function chooseMode(state) {
    const task = workerTask(state, 'player');
    if (task && task.zone !== zoneId) {
      me.mode = 'away'; me.spot = null; me.target = null;
      return task;
    }
    const spot = spotFor(task);
    if (!spot) {
      if (me.mode === 'work' || me.mode === 'away' || me.spot) {
        // Stopped working: walk back to the middle.
        const [x, y] = px(...scene.idle);
        me.spot = null;
        me.target = { x, y, face: 'down' };
        me.mode = me.mode === 'away' ? 'idle' : 'walk';
        if (me.mode === 'idle') { me.x = x; me.y = y; me.target = null; }
      }
      return task;
    }
    if (me.spot !== spot) {
      me.spot = spot;
      const t = standOf(spot);
      if (!me.placed || me.mode === 'away') { me.x = t.x; me.y = t.y; me.mode = 'work'; me.target = null; }
      else { me.target = t; me.mode = 'walk'; }
    }
    return task;
  }

  function dirToward(dx, dy) {
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }

  function stepWalk(ms) {
    const dx = me.target.x - me.x;
    const dy = me.target.y - me.y;
    const dist = Math.hypot(dx, dy);
    const step = cfg.walkSpeedPxPerSec * scale * ms / 1000;
    if (dist <= step) {
      me.x = me.target.x; me.y = me.target.y;
      me.dir = me.target.face || me.dir;
      me.mode = me.spot ? 'work' : 'idle';
      me.target = null;
      return;
    }
    me.x += (dx / dist) * step;
    me.y += (dy / dist) * step;
    me.dir = dirToward(dx, dy);
  }

  // Tool angle (radians) for progress p (0..1) of the current action.
  function toolAngle(pose, p) {
    let a;
    if (p < cfg.windupFrac) a = lerp(pose.rest, pose.windup, easeInOut(p / cfg.windupFrac)); // slow wind-up
    else a = lerp(pose.windup, pose.strike, easeIn(clamp01((p - cfg.windupFrac) / (1 - cfg.windupFrac)))); // snap
    if (me.bounceMs < cfg.blendMs) a = lerp(pose.strike, a, easeInOut(me.bounceMs / cfg.blendMs)); // ease back after a hit
    return a * DEG;
  }

  function render(state, task, ms, ticker) {
    me.bounceMs += ms;
    const view = player.view;
    view.visible = me.mode !== 'away';
    if (!view.visible) return;

    if (me.mode === 'walk') stepWalk(ms);

    let bob = 0;
    let sx = scale;
    let sy = scale;
    if (me.mode === 'walk') {
      heldSprite.visible = false;
      player.play('walk', me.dir);
      player.update(ticker);
    } else if (me.mode === 'work' && task && me.spot) {
      const kind = data.skills.skills.find((s) => s.id === task.skill)?.tool;
      setHeld(kind);
      const w = state.workers.player;
      const dur = actionMs(state, data, 'player', task);
      const p = clamp01(w.progressMs / dur);
      const hasSwing = bank.animNames('player').includes('swing');
      me.dir = me.spot.face || me.dir;
      if (hasSwing) {
        player.play('swing', me.dir);
        player.sprite.gotoAndStop(p < cfg.windupFrac ? 0 : Math.min(1, player.sprite.totalFrames - 1));
      } else {
        player.play('idle', me.dir);
      }
      const pose = cfg.held[kind];
      if (heldRole && pose) {
        const sign = me.dir === 'left' ? -1 : 1;
        const hand = cfg.hand[me.dir];
        heldSprite.visible = true;
        heldSprite.position.set(hand[0], hand[1]);
        heldSprite.scale.x = sign;
        heldSprite.rotation = sign * toolAngle(pose, p);
      } else {
        heldSprite.visible = false;
      }
      if (me.bounceMs < cfg.bounceMs) {
        const k = Math.sin(Math.PI * me.bounceMs / cfg.bounceMs);
        bob = -cfg.bouncePx * scale * k;
        sy = scale * (1 - cfg.squash * k);
        sx = scale * (1 + cfg.squash * k * 0.5);
      }
    } else {
      heldSprite.visible = false;
      player.play('idle', me.dir);
      player.update(ticker);
    }
    view.scale.set(sx, sy);
    view.position.set(Math.round(me.x), Math.round(me.y + bob));
    view.zIndex = playerZ();
  }

  // ---- harvest pops ----
  const pops = []; // { c, age, x0, y0, sparkles }
  function makeSparkle(i, n) {
    const g = new Graphics();
    g.rect(-1, -3, 2, 6).fill(0xfff3a0);
    g.rect(-3, -1, 6, 2).fill(0xfff3a0);
    const ang = (i / n) * Math.PI * 2 + Math.random();
    return { g, vx: Math.cos(ang), vy: Math.sin(ang) - 0.4, phase: Math.random() };
  }
  function addPop(itemId, qty, rare, index, count) {
    const c = new Container();
    const tex = bank.texture(`item.${itemId}`);
    const iconScale = scale >= cfg.pixelScaleWide ? cfg.popIconScaleWide : cfg.popIconScale;
    let iconW = 0;
    if (tex) {
      const icon = new Sprite(tex);
      icon.scale.set(iconScale);
      icon.anchor.set(0, 0.5);
      c.addChild(icon);
      iconW = tex.width * iconScale + 2;
    }
    const label = new Text({
      text: `+${qty}`,
      style: {
        fontFamily: 'NormalFont',
        fontSize: cfg.popFontSize,
        fill: rare ? 0xffe066 : 0xffffff,
        stroke: { color: 0x2a2433, width: 3, join: 'round' },
      },
    });
    label.anchor.set(0, 0.5);
    label.position.set(iconW, 0);
    c.addChild(label);
    c.pivot.set(Math.round((iconW + label.width) / 2), 0); // centred on the pop's x
    const spacing = cfg.popSpacingPx * (iconScale);
    const x0 = me.x + (index - (count - 1) / 2) * spacing + (Math.random() * 2 - 1) * cfg.popJitterPx;
    const y0 = me.y - 16 * scale - 6;
    const pop = { c, age: 0, x0, y0, sparkles: [] };
    if (rare) {
      for (let i = 0; i < cfg.rareSparkles; i++) {
        const s = makeSparkle(i, cfg.rareSparkles);
        fx.addChild(s.g);
        pop.sparkles.push(s);
      }
    }
    fx.addChild(c);
    pops.push(pop);
    while (pops.length > cfg.maxPops) removePop(pops.shift());
  }
  function removePop(pop) {
    pop.c.destroy({ children: true });
    for (const s of pop.sparkles) s.g.destroy();
  }
  function updatePops(ms) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const pop = pops[i];
      pop.age += ms;
      const t = pop.age / cfg.popRiseMs;
      if (t >= 1) { removePop(pop); pops.splice(i, 1); continue; }
      pop.c.position.set(Math.round(pop.x0), Math.round(pop.y0 - easeOutRise(t) * cfg.popRisePx * scale));
      pop.c.alpha = t < cfg.popFadeStartFrac ? 1 : 1 - (t - cfg.popFadeStartFrac) / (1 - cfg.popFadeStartFrac);
      for (const s of pop.sparkles) {
        const d = easeOutRise(t) * 14 * scale;
        s.g.position.set(Math.round(pop.x0 + s.vx * d), Math.round(pop.y0 + s.vy * d));
        s.g.alpha = pop.c.alpha * (0.5 + 0.5 * Math.sin((t * 6 + s.phase) * Math.PI));
      }
    }
  }
  const easeOutRise = (t) => 1 - (1 - t) * (1 - t);

  const unsubscribe = game.onEvents((events) => {
    if (!running || destroyed) return;
    for (const e of events) {
      if (e.type !== 'harvest' || e.worker !== 'player' || e.zone !== zoneId) continue;
      me.bounceMs = 0;
      const entries = Object.entries(e.items || {}).filter(([, n]) => n > 0);
      entries.forEach(([id, n], i) => addPop(id, n, !!e.rare, i, entries.length));
    }
  });

  layout();
  app.renderer.on('resize', layout);

  app.ticker.add((ticker) => {
    const state = game.getState();
    const task = chooseMode(state);
    render(state, task, ticker.deltaMS, ticker);
    updatePops(ticker.deltaMS);
  });

  return {
    start() { running = true; app.start(); },
    stop() { running = false; app.stop(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      app.renderer.off('resize', layout);
      app.destroy(true, { children: true });
    },
  };
}
