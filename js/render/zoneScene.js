// Zone scene (PixiJS): the strip of countryside at the top of a zone page. Draws the zone's harvest
// spots (tree, rock, bush, burrow, pond) and decor from data/zones.json "scene", puts the player and
// the active pets at the spot for their current task and animates the work (the player's wind-up
// and strike synced to the action progress, a pet's squash-and-stretch hop on each finished action),
// and floats "+N <item>" pops when the simulation reports a harvest. Resting pets nap with floating "z"s.
// Read-only: it never changes game state. Every number comes from data.balance.render.zone
// (pets: render.zone.pets) and the zone's scene data. Render-only randomness uses Math.random.
// createZoneScene(host, game, zoneId) -> { start(), stop(), destroy() }. It is created and destroyed
// each time the zone page opens and closes, so destroy() must release everything.
import { Application, Container, Graphics, Rectangle, Sprite, Text, TextureSource } from '../../lib/pixi.mjs';
import { loadSprites, createActor } from './sprites.js';
import { actionMs, workerTask } from '../systems/harvest.js';
import { petStatus } from '../systems/pets.js';
import { petRole } from '../systems/petstats.js';
import { createPolish } from './polish.js';

TextureSource.defaultOptions.scaleMode = 'nearest';

const DEG = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeInOut = (t) => t * t * (3 - 2 * t);
const easeIn = (t) => t * t * t;
const easeOutRise = (t) => 1 - (1 - t) * (1 - t);

// options.onSpotTap(skillId): called when the player taps a harvest spot (the tree, the pond...).
// The scene never acts on it itself; the World tab decides who gets the job.
export async function createZoneScene(host, game, zoneId, { onSpotTap } = {}) {
  const data = game.data;
  const cfg = data.balance.render.zone;
  const pcfg = cfg.pets;
  const zone = data.zones.zones.find((z) => z.id === zoneId);
  const scene = zone?.scene || { spots: {}, decor: [], idle: [0.5, 0.9] };
  const colorOf = (v) => Number(v); // balance.json stores colors as "0xrrggbb" strings

  const app = new Application();
  await app.init({
    resizeTo: host,
    background: colorOf(scene.ground || cfg.groundColor),
    antialias: false,
    roundPixels: true,
    resolution: Math.min(window.devicePixelRatio || 1, data.balance.render.maxResolution),
    autoDensity: true,
  });
  host.append(app.canvas);
  // Taps on spots are handled, but a drag that starts on the picture still scrolls the page.
  app.renderer.events.autoPreventDefault = false;
  app.canvas.style.touchAction = 'pan-y';
  try { await document.fonts.load(`${cfg.popFontSize}px NormalFont`); } catch { /* fall back to the default font */ }

  const bank = await loadSprites(data.sprites);

  const ground = new Graphics();
  const world = new Container();
  world.sortableChildren = true;
  const fx = new Container();
  const polish = createPolish(app, { cfg: data.balance.render.polish, bank });
  app.stage.addChild(ground, polish.shadows, world, polish.air, polish.tint, fx, polish.top);

  let scale = cfg.pixelScale;
  let running = true;
  let destroyed = false;

  // ---- props: spots and decor, positioned in fractions of the scene ----
  const props = []; // { sprite, fx, fy, tappable }
  function addProp(roleId, fx, fy, skillId = null) {
    const tex = bank.texture(roleId);
    if (!tex) return null; // not cast yet: leave it out
    const sprite = new Sprite(tex);
    const [ax, ay] = bank.anchor(roleId);
    sprite.anchor.set(ax, ay);
    world.addChild(sprite);
    const p = { sprite, fx, fy, tappable: !!(skillId && onSpotTap), shadow: null };
    if (!data.balance.render.polish.shadow.skipProps.includes(roleId)) {
      p.shadow = polish.addShadow(sprite, tex.width * data.balance.render.polish.shadow.propWidthFrac);
    }
    if (p.tappable) {
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      sprite.on('pointertap', () => { if (running && !destroyed) onSpotTap(skillId); });
    }
    props.push(p);
    return p;
  }
  // A spot's tap area is at least render.zone.tapMinPx across (CSS pixels), however small its picture.
  function sizeHitArea(p) {
    const { sprite } = p;
    const tex = sprite.texture;
    const min = cfg.tapMinPx / scale;
    const w = Math.max(tex.width, min);
    const h = Math.max(tex.height, min);
    const cx = (0.5 - sprite.anchor.x) * tex.width;
    const cy = (0.5 - sprite.anchor.y) * tex.height;
    sprite.hitArea = new Rectangle(cx - w / 2, cy - h / 2, w, h);
  }
  for (const [skillId, spot] of Object.entries(scene.spots || {})) addProp(spot.prop, spot.x, spot.y, skillId);
  for (const d of scene.decor || []) addProp(d.prop, d.x, d.y);

  function sizeNow() { return { w: app.screen.width, h: app.screen.height }; }
  const px = (fx, fy) => { const { w, h } = sizeNow(); return [Math.round(fx * w), Math.round(fy * h)]; };

  // ---- workers: the player and each active pet ----
  // w = { id, role, isPlayer, actor, index, x, y, mode: 'idle'|'walk'|'work'|'away', dir,
  //       target: { x, y, face, wander } while walking, spot, bounceMs (time since the last finished
  //       action), placed, standIdx, wanderMs, zMs, frozen, heldSprite/heldRole (player only) }
  const workers = new Map();

  function addWorker(id, role, index) {
    const actor = createActor(bank, role, { anim: 'idle', dir: 'down' });
    actor.view.scale.set(scale);
    world.addChild(actor.view);
    const w = {
      id, role, isPlayer: id === 'player', actor, index,
      x: 0, y: 0, mode: 'idle', dir: 'down', target: null, spot: null,
      bounceMs: Infinity, placed: false, standIdx: -1,
      wanderMs: lerp(pcfg.wanderMinPauseMs, pcfg.wanderMaxPauseMs, Math.random()),
      zMs: 0, frozen: false, heldSprite: null, heldRole: null,
      shadow: null,
    };
    if (w.isPlayer) {
      w.heldSprite = new Sprite();
      w.heldSprite.visible = false;
      // Behind the character's body, so the tool reads as held rather than pasted on top.
      actor.view.addChildAt(w.heldSprite, 0);
    }
    const home = homeOf(w);
    w.x = home.x; w.y = home.y;
    w.placed = true;
    w.shadow = polish.addShadow(actor.view, data.balance.render.home.shadowCharacterWidthPx);
    workers.set(id, w);
    placeView(w);
    return w;
  }

  // Keep the set of workers equal to the player plus the pets in the active slots.
  function syncWorkers(state) {
    const want = ['player'];
    for (const id of state.pets.active) if (id && state.pets.list[id]) want.push(id);
    for (const [id, w] of [...workers]) {
      if (!want.includes(id)) { w.actor.destroy(); workers.delete(id); }
    }
    want.forEach((id, i) => {
      let w = workers.get(id);
      const role = id === 'player' ? 'player' : petRole(state.pets.list[id]);
      if (w && w.role !== role) { w.actor.destroy(); workers.delete(id); w = null; }
      if (!w) w = addWorker(id, role, i);
      w.index = i;
    });
  }

  function offsetOf(list, w) {
    const o = list[w.index] || list[list.length - 1] || [0, 0];
    return [o[0] * scale, o[1] * scale];
  }
  function standOf(spot, w) {
    const [x, y] = px(spot.stand[0], spot.stand[1]);
    const [ox, oy] = offsetOf(pcfg.standOffsets, w);
    return { x: x + ox, y: y + oy, face: spot.face };
  }
  function homeOf(w) {
    const [x, y] = px(...scene.idle);
    const [ox, oy] = offsetOf(pcfg.idleOffsets, w);
    return { x: x + ox, y: y + oy, face: 'down' };
  }
  function spotFor(task) {
    return task && task.zone === zoneId ? scene.spots?.[task.skill] || null : null;
  }

  function drawGround() {
    const { w, h } = sizeNow();
    ground.clear();
    // Small darker grass flecks at fixed pseudo-random places (stable across resizes).
    const speck = colorOf(scene.speck || cfg.speckColor);
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
    polish.resize(w, h, scale);
    for (const p of props) {
      const [x, y] = px(p.fx, p.fy);
      p.sprite.scale.set(scale);
      p.sprite.position.set(x, y);
      p.sprite.zIndex = y;
      if (p.tappable) sizeHitArea(p);
    }
    const state = game.getState();
    for (const m of workers.values()) {
      m.actor.view.scale.set(scale);
      // Re-aim at the (rescaled) place.
      if (m.mode === 'walk' && m.target) {
        const s = spotFor(workerTask(state, m.id));
        m.target = s ? standOf(s, m) : { ...homeOf(m), wander: false };
      } else if (m.mode === 'work' && m.spot) {
        const t = standOf(m.spot, m);
        m.x = t.x; m.y = t.y;
      } else if (m.mode === 'idle' || !m.placed) {
        const t = homeOf(m);
        m.x = t.x; m.y = t.y;
      }
      m.placed = true;
      placeView(m);
    }
  }

  function placeView(m) {
    m.actor.view.position.set(Math.round(m.x), Math.round(m.y));
    m.actor.view.zIndex = workerZ(m);
  }
  // While working, draw in front of the spot's prop so the held tool (a rod over the pond)
  // is never hidden behind it.
  function workerZ(m) {
    const front = m.mode === 'work' && m.spot ? px(m.spot.x, m.spot.y)[1] + 1 : 0;
    return Math.max(Math.round(m.y), front);
  }

  // ---- held tool (player only) ----
  function setHeld(m, kind) {
    const role = kind ? `held.${kind}` : null;
    if (role === m.heldRole) return;
    m.heldRole = role;
    const tex = role && bank.texture(role);
    if (!tex) { m.heldSprite.visible = false; m.heldRole = null; return; }
    m.heldSprite.texture = tex;
    const [ax, ay] = bank.anchor(role);
    m.heldSprite.anchor.set(ax, ay);
  }

  // ---- state -> behaviour ----
  function chooseMode(m, state) {
    const task = workerTask(state, m.id);
    if (task && task.zone !== zoneId) {
      m.mode = 'away'; m.spot = null; m.target = null; m.standIdx = -1;
      return task;
    }
    const spot = spotFor(task);
    if (!spot) {
      if (m.mode === 'work' || m.mode === 'away' || m.spot) {
        // Stopped working: walk back to the middle.
        const home = homeOf(m);
        m.spot = null; m.standIdx = -1;
        m.target = { ...home, wander: false };
        m.mode = m.mode === 'away' ? 'idle' : 'walk';
        if (m.mode === 'idle') { m.x = home.x; m.y = home.y; m.target = null; }
      }
      return task;
    }
    if (m.spot !== spot || m.standIdx !== m.index) {
      m.spot = spot;
      m.standIdx = m.index;
      const t = standOf(spot, m);
      if (!m.placed || m.mode === 'away') { m.x = t.x; m.y = t.y; m.mode = 'work'; m.target = null; }
      else { m.target = t; m.mode = 'walk'; }
    }
    return task;
  }

  function dirToward(dx, dy) {
    return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }

  function stepWalk(m, ms) {
    const dx = m.target.x - m.x;
    const dy = m.target.y - m.y;
    const dist = Math.hypot(dx, dy);
    const speed = m.target.wander ? pcfg.wanderSpeedPxPerSec : cfg.walkSpeedPxPerSec;
    const step = speed * scale * ms / 1000;
    if (dist <= step) {
      m.x = m.target.x; m.y = m.target.y;
      m.dir = m.target.face || m.dir;
      m.mode = m.spot ? 'work' : 'idle';
      m.target = null;
      m.wanderMs = lerp(pcfg.wanderMinPauseMs, pcfg.wanderMaxPauseMs, Math.random());
      return;
    }
    m.x += (dx / dist) * step;
    m.y += (dy / dist) * step;
    m.dir = dirToward(dx, dy);
  }

  // An idle pet takes a short walk to a random spot near its home point now and then.
  function maybeWander(m, ms) {
    m.wanderMs -= ms;
    if (m.wanderMs > 0) return;
    const home = homeOf(m);
    const r = pcfg.wanderRadiusPx * scale;
    const { w, h } = sizeNow();
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * r;
    m.target = {
      x: Math.min(w, Math.max(0, Math.round(home.x + Math.cos(ang) * dist))),
      y: Math.min(h, Math.max(0, Math.round(home.y + Math.sin(ang) * dist))),
      face: null,
      wander: true,
    };
    m.mode = 'walk';
  }

  // Tool angle (radians) for progress p (0..1) of the current action.
  function toolAngle(m, pose, p) {
    let a;
    if (p < cfg.windupFrac) a = lerp(pose.rest, pose.windup, easeInOut(p / cfg.windupFrac)); // slow wind-up
    else a = lerp(pose.windup, pose.strike, easeIn(clamp01((p - cfg.windupFrac) / (1 - cfg.windupFrac)))); // snap
    if (m.bounceMs < cfg.blendMs) a = lerp(pose.strike, a, easeInOut(m.bounceMs / cfg.blendMs)); // ease back after a hit
    return a * DEG;
  }

  function renderPlayer(m, state, task, ticker) {
    const actor = m.actor;
    let bob = 0;
    let sx = scale;
    let sy = scale;
    if (m.mode === 'walk') {
      m.heldSprite.visible = false;
      actor.play('walk', m.dir);
      actor.update(ticker);
    } else if (m.mode === 'work' && task && m.spot) {
      const kind = data.skills.skills.find((s) => s.id === task.skill)?.tool;
      setHeld(m, kind);
      const wk = state.workers.player;
      const dur = actionMs(state, data, 'player', task);
      const p = clamp01(wk.progressMs / dur);
      const hasSwing = bank.animNames('player').includes('swing');
      m.dir = m.spot.face || m.dir;
      if (hasSwing) {
        actor.play('swing', m.dir);
        actor.sprite.gotoAndStop(p < cfg.windupFrac ? 0 : Math.min(1, actor.sprite.totalFrames - 1));
      } else {
        actor.play('idle', m.dir);
      }
      const pose = cfg.held[kind];
      if (m.heldRole && pose) {
        const sign = m.dir === 'left' ? -1 : 1;
        const hand = cfg.hand[m.dir];
        m.heldSprite.visible = true;
        m.heldSprite.position.set(hand[0], hand[1]);
        m.heldSprite.scale.x = sign;
        m.heldSprite.rotation = sign * toolAngle(m, pose, p);
      } else {
        m.heldSprite.visible = false;
      }
      if (m.bounceMs < cfg.bounceMs) {
        const k = Math.sin(Math.PI * m.bounceMs / cfg.bounceMs);
        bob = -cfg.bouncePx * scale * k;
        sy = scale * (1 - cfg.squash * k);
        sx = scale * (1 + cfg.squash * k * 0.5);
      }
    } else {
      m.heldSprite.visible = false;
      actor.play('idle', m.dir);
      actor.update(ticker);
    }
    return { bob, sx, sy };
  }

  function renderPet(m, state, ms, ticker) {
    const actor = m.actor;
    const resting = petStatus(state, m.id) === 'resting';
    let bob = 0;
    let sx = scale;
    let sy = scale;
    if (m.frozen && !(resting && m.mode !== 'walk')) { actor.sprite.play(); m.frozen = false; }
    if (m.mode === 'walk') {
      actor.play('walk', m.dir);
      actor.update(ticker);
    } else if (resting) {
      if (m.spot) m.dir = m.spot.face || m.dir;
      actor.play('idle', m.dir);
      actor.sprite.gotoAndStop(pcfg.restFrame);
      m.frozen = true;
      m.zMs += ms;
      if (m.zMs >= pcfg.zIntervalMs) { m.zMs = 0; addZ(m); }
    } else {
      if (m.mode === 'work' && m.spot) m.dir = m.spot.face || m.dir;
      else if (m.mode === 'idle') maybeWander(m, ms);
      actor.play('idle', m.dir);
      actor.update(ticker);
    }
    if (!resting) m.zMs = 0;
    if (m.bounceMs < pcfg.hopMs) {
      const t = m.bounceMs / pcfg.hopMs;
      const air = Math.sin(Math.PI * t);
      const land = Math.sin(Math.PI * clamp01((t - pcfg.landFrac) / (1 - pcfg.landFrac)));
      const f = pcfg.stretch * air - pcfg.squash * land; // tall in the air, squashed on landing
      bob = -pcfg.hopPx * scale * air;
      sy = scale * (1 + f);
      sx = scale * (1 - f * 0.5);
    }
    return { bob, sx, sy };
  }

  function renderWorker(m, state, task, ms, ticker) {
    m.bounceMs += ms;
    const view = m.actor.view;
    view.visible = m.mode !== 'away';
    if (!view.visible) return;
    if (m.mode === 'walk') stepWalk(m, ms);
    const { bob, sx, sy } = m.isPlayer ? renderPlayer(m, state, task, ticker) : renderPet(m, state, ms, ticker);
    view.scale.set(sx, sy);
    view.position.set(Math.round(m.x), Math.round(m.y + bob));
    view.zIndex = workerZ(m);
    if (m.shadow) m.shadow.groundY = m.y; // the shadow stays on the ground while the body hops
  }

  // ---- floating z's for resting pets ----
  const zs = []; // { t, age, x0, y0, phase }
  function addZ(m) {
    if (zs.length >= pcfg.maxZ) removeZ(zs.shift());
    const t = new Text({
      text: 'z',
      style: {
        fontFamily: 'NormalFont',
        fontSize: pcfg.zFontSize,
        fill: colorOf(pcfg.zColor),
        stroke: { color: 0x2a2433, width: 3, join: 'round' },
      },
    });
    t.anchor.set(0.5);
    fx.addChild(t);
    zs.push({
      t, age: 0, phase: Math.random() * Math.PI * 2,
      x0: m.x + pcfg.zOffsetXPx * scale,
      y0: m.y - pcfg.zOffsetYPx * scale,
    });
  }
  function removeZ(z) { z.t.destroy(); }
  function updateZs(ms) {
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      z.age += ms;
      const k = z.age / pcfg.zRiseMs;
      if (k >= 1) { removeZ(z); zs.splice(i, 1); continue; }
      z.t.position.set(
        Math.round(z.x0 + Math.sin(z.phase + k * Math.PI * 2) * pcfg.zSwayPx * scale),
        Math.round(z.y0 - easeOutRise(k) * pcfg.zRisePx * scale));
      z.t.alpha = 1 - k;
    }
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
  function addPop(m, itemId, qty, rare, index, count) {
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
    const x0 = m.x + (index - (count - 1) / 2) * spacing + (Math.random() * 2 - 1) * cfg.popJitterPx;
    const y0 = m.y - 16 * scale - 6;
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

  const unsubscribe = game.onEvents((events) => {
    if (!running || destroyed) return;
    for (const e of events) {
      if (e.type !== 'harvest' || e.zone !== zoneId) continue;
      const m = workers.get(e.worker);
      if (!m || m.mode === 'away') continue;
      m.bounceMs = 0;
      const entries = Object.entries(e.items || {}).filter(([, n]) => n > 0);
      entries.forEach(([id, n], i) => addPop(m, id, n, !!e.rare, i, entries.length));
    }
  });

  syncWorkers(game.getState());
  layout();
  app.renderer.on('resize', layout);
  // The host may be hidden (zero size) when the scene is built; follow its real size once it shows.
  const sizeWatch = new ResizeObserver(() => { if (host.clientWidth && !destroyed) app.resize(); });
  sizeWatch.observe(host);

  app.ticker.add((ticker) => {
    const state = game.getState();
    syncWorkers(state);
    for (const m of workers.values()) {
      const task = chooseMode(m, state);
      renderWorker(m, state, task, ticker.deltaMS, ticker);
    }
    updatePops(ticker.deltaMS);
    updateZs(ticker.deltaMS);
    polish.update(ticker.deltaMS);
  });

  return {
    start() { running = true; app.start(); },
    stop() { running = false; app.stop(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      sizeWatch.disconnect();
      app.renderer.off('resize', layout);
      polish.destroy();
      app.destroy(true, { children: true });
    },
  };
}
