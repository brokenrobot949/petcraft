// Zone scene (PixiJS): the strip of countryside at the top of a zone page. Draws the zone's harvest
// spots (tree, rock, bush, burrow, pond) and decor from data/zones.json "scene", puts the player and
// the active pets at the spot for their current task and animates the work (the player's wind-up
// and strike synced to the action progress, a pet's squash-and-stretch hop on each finished action),
// and floats "+N <item>" pops when the simulation reports a harvest. Resting pets nap with floating "z"s.
// Emote bubbles (js/render/emotes.js) pop up over workers: a rare find, a map, a level, tiredness.
// Read-only: it never changes game state. Every number comes from data.balance.render.zone
// (pets: render.zone.pets) and the zone's scene data. Render-only randomness uses Math.random.
// createZoneScene(host, game, zoneId) -> { start(), stop(), destroy() }. It is created and destroyed
// each time the zone page opens and closes, so destroy() must release everything.
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureSource } from '../../lib/pixi.mjs';
import { loadSprites, createActor } from './sprites.js';
import { createEmotes, emoteFor, actorTarget } from './emotes.js';
import { actionMs, workerTask, isHarvestTask } from '../systems/harvest.js';
import { mapCount } from '../systems/treasure.js';
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
  const tcfg = cfg.taming; // Phase 7: tracking, digging, waiting encounters and traps
  const zone = data.zones.zones.find((z) => z.id === zoneId);
  // Any zone with a scene draws generically; a zone without one yet (or with a partial one) gets a bare field.
  const scene = { spots: {}, decor: [], idle: [0.5, 0.9], ...(zone?.scene || {}) };
  // Mythic boss strips are drawn at this share of the pixel scale.
  const roleK = (role) => (role.startsWith('mythic.') ? data.balance.render.mythicScale : 1);
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
  const emotes = createEmotes(fx, bank, data.balance.render.emotes);

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
  // Harvest spots are tappable props. The tracking and dig spots (tcfg.spotKeys) are not: the player
  // only stands there, and the dig site picture shows while digging or while the zone has maps.
  const taskSpotKeys = Object.values(tcfg.spotKeys);
  let digProp = null;
  for (const [skillId, spot] of Object.entries(scene.spots || {})) {
    if (!spot.prop) continue;
    if (taskSpotKeys.includes(skillId)) {
      if (skillId === tcfg.spotKeys.treasure) digProp = addProp(spot.prop, spot.x, spot.y);
      continue;
    }
    addProp(spot.prop, spot.x, spot.y, skillId);
  }
  for (const d of scene.decor || []) addProp(d.prop, d.x, d.y);
  if (digProp) digProp.sprite.visible = false;

  function sizeNow() { return { w: app.screen.width, h: app.screen.height }; }
  const px = (fx, fy) => { const { w, h } = sizeNow(); return [Math.round(fx * w), Math.round(fy * h)]; };

  // ---- workers: the player and each active pet ----
  // w = { id, role, isPlayer, actor, index, x, y, mode: 'idle'|'walk'|'work'|'away', dir,
  //       target: { x, y, face, wander } while walking, spot, bounceMs (time since the last finished
  //       action), placed, standIdx, wanderMs, zMs, frozen, heldSprite/heldRole (player only) }
  const workers = new Map();

  function addWorker(id, role, index) {
    const actor = createActor(bank, role, { anim: 'idle', dir: 'down' });
    const k = roleK(role);
    actor.view.scale.set(scale * k);
    world.addChild(actor.view);
    const w = {
      id, role, k, isPlayer: id === 'player', actor, index,
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
    w.shadow = polish.addShadow(actor.view, shadowWidth(actor, k));
    workers.set(id, w);
    placeView(w);
    return w;
  }

  // Shadow width (sprite units): mythic bosses are much bigger than a pet.
  function shadowWidth(actor, k) {
    const base = data.balance.render.home.shadowCharacterWidthPx;
    return k === 1 ? base : Math.max(base, actor.sprite.texture.width * k * data.balance.render.mythicShadowFrac);
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
    if (!task || task.zone !== zoneId) return null;
    const spot = scene.spots?.[tcfg.spotKeys[task.skill] || task.skill];
    return spot && spot.stand ? spot : null;
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
      m.actor.view.scale.set(scale * m.k);
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
    const front = m.mode === 'work' && m.spot && m.spot.y != null ? px(m.spot.x, m.spot.y)[1] + 1 : 0;
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
    const speed = m.target.speed || (m.target.wander ? pcfg.wanderSpeedPxPerSec : cfg.walkSpeedPxPerSec);
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

  function renderPlayer(m, state, task, ticker, ms) {
    const actor = m.actor;
    let bob = 0;
    let sx = scale;
    let sy = scale;
    if (m.mode === 'walk') {
      m.heldSprite.visible = false;
      actor.play('walk', m.dir);
      actor.update(ticker);
    } else if (m.mode === 'work' && task && m.spot) {
      // Harvesting swings the skill's tool with the action's progress. Digging swings the shovel on a
      // steady rhythm (not tied to the dig's length). Tracking holds nothing and wanders (stepTracking).
      let kind = null;
      let p = 0;
      let pose = null;
      if (isHarvestTask(data, task)) {
        kind = data.skills.skills.find((s) => s.id === task.skill)?.tool;
        const dur = actionMs(state, data, 'player', task);
        p = clamp01(state.workers.player.progressMs / dur);
        pose = cfg.held[kind];
      } else if (task.skill === 'treasure') {
        kind = 'shovel';
        m.digMs = (m.digMs || 0) + ms;
        if (m.digMs >= tcfg.digSwingMs) { m.digMs %= tcfg.digSwingMs; m.bounceMs = 0; } // the shovel lands
        p = m.digMs / tcfg.digSwingMs;
        pose = tcfg.shovelPose;
      }
      setHeld(m, kind);
      const hasSwing = !!kind && bank.animNames('player').includes('swing');
      if (task.skill === 'taming') {
        if (m.trackLook) m.dir = m.trackLook;
      } else {
        m.dir = m.spot.face || m.dir;
      }
      if (hasSwing) {
        actor.play('swing', m.dir);
        actor.sprite.gotoAndStop(p < cfg.windupFrac ? 0 : Math.min(1, actor.sprite.totalFrames - 1));
      } else {
        actor.play('idle', m.dir);
      }
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
      if (kind && m.bounceMs < cfg.bounceMs) {
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

  // While the player tracks, they stroll slowly around the tracking spot, pausing now and then to look about.
  const DIRS = ['down', 'up', 'left', 'right'];
  function stepTracking(m, task, ms) {
    if (m.mode !== 'work' || !m.spot || task?.skill !== 'taming') { m.trackMs = null; m.trackLook = null; return; }
    if (m.trackMs == null) m.trackMs = lerp(tcfg.trackPauseMinMs, tcfg.trackPauseMaxMs, Math.random());
    m.trackMs -= ms;
    if (m.trackMs > 0) return;
    m.trackMs = lerp(tcfg.trackPauseMinMs, tcfg.trackPauseMaxMs, Math.random());
    if (Math.random() < tcfg.trackLookChance) { m.trackLook = DIRS[Math.floor(Math.random() * DIRS.length)]; return; }
    const home = standOf(m.spot, m);
    const { w, h } = sizeNow();
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * tcfg.trackRadiusPx * scale;
    m.trackLook = null;
    m.target = {
      x: Math.min(w, Math.max(0, Math.round(home.x + Math.cos(ang) * dist))),
      y: Math.min(h, Math.max(0, Math.round(home.y + Math.sin(ang) * dist))),
      face: null, wander: true, speed: tcfg.trackWalkSpeedPxPerSec,
    };
    m.mode = 'walk';
  }

  // ---- Phase 7: the waiting encounter and the trap set beside it ----
  let enc = null;      // { archetype, actor, shadow, alpha, hopMs, nextHopMs, ageMs }
  let trapSprite = null;
  let trapShadow = null;
  let trapAgeMs = 0;
  function encounterPlace() { return scene.encounter || tcfg.defaultEncounter; }
  // A mythic encounter glows and throws off sparkles so it reads as special.
  const mcfg = tcfg.mythic;
  let glowTex = null;
  function makeMythicFx() {
    if (!glowTex) {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      glowTex = Texture.from(c);
      glowTex.source.scaleMode = 'linear';
    }
    const glow = new Sprite(glowTex);
    glow.anchor.set(0.5);
    glow.tint = colorOf(mcfg.glowColor);
    glow.blendMode = 'add';
    world.addChild(glow);
    const sparkles = [];
    for (let i = 0; i < mcfg.sparkles; i++) {
      const g = new Graphics();
      g.rect(-1, -3, 2, 6).fill(colorOf(mcfg.sparkleColor));
      g.rect(-3, -1, 6, 2).fill(colorOf(mcfg.sparkleColor));
      fx.addChild(g);
      sparkles.push({ g, phase: i / mcfg.sparkles, sway: Math.random() * Math.PI * 2 });
    }
    return { glow, sparkles };
  }
  function updateMythicFx(e, ex, ey) {
    const m = e.mythicFx;
    const fade = clamp01(e.ageMs / tcfg.encounterFadeMs);
    const pulse = 1 + mcfg.glowPulseAmp * Math.sin(e.ageMs / mcfg.glowPulseMs * Math.PI * 2);
    const cy = ey - mcfg.glowDropPx * scale;
    m.glow.position.set(Math.round(ex), Math.round(cy));
    m.glow.scale.set(mcfg.glowRadiusPx * 2 * scale * pulse / glowTex.width);
    m.glow.alpha = mcfg.glowAlpha * fade;
    m.glow.zIndex = ey - 1;
    for (const s of m.sparkles) {
      const t = ((e.ageMs / mcfg.sparkleMs) + s.phase) % 1;
      s.g.scale.set(scale * 0.5);
      s.g.position.set(Math.round(ex + Math.sin(s.sway + t * Math.PI * 2) * mcfg.sparkleSpreadPx * scale),
        Math.round(cy - t * mcfg.sparkleRisePx * scale));
      s.g.alpha = Math.sin(Math.PI * t) * fade;
    }
  }
  function removeEncounter() {
    if (!enc) return;
    if (enc.mythicFx) {
      enc.mythicFx.glow.destroy();
      for (const s of enc.mythicFx.sparkles) s.g.destroy();
    }
    enc.shadow?.remove();
    enc.actor.destroy();
    enc = null;
  }
  function removeTrap() {
    if (!trapSprite) return;
    trapShadow?.remove();
    trapSprite.destroy();
    trapSprite = null; trapShadow = null;
  }
  function updateTaming(state, ms, ticker) {
    const place = encounterPlace();
    const [ex, ey] = px(place.x, place.y);
    const e = state.taming?.encounters?.[zoneId] || null;
    let role = e ? (e.mythic ? `mythic.${e.archetype}` : `pet.${e.archetype}.hatchling`) : null;
    if (e?.mythic && !bank.has(role)) role = `pet.${e.archetype}.hatchling`; // mythic art not packed yet: a glowing hatchling
    if (enc && (!e || enc.role !== role)) removeEncounter();
    if (e && !enc && bank.has(role)) {
      const actor = createActor(bank, role, { anim: 'idle', dir: place.face });
      const k = roleK(role);
      actor.view.scale.set(scale * k);
      world.addChild(actor.view);
      enc = { role, k, actor, shadow: polish.addShadow(actor.view, shadowWidth(actor, k)),
        mythicFx: e.mythic ? makeMythicFx() : null,
        ageMs: 0, hopMs: Infinity, nextHopMs: lerp(tcfg.encounterHopMinMs, tcfg.encounterHopMaxMs, Math.random()) };
      actor.view.alpha = 0;
    }
    if (enc) {
      enc.ageMs += ms;
      enc.nextHopMs -= ms;
      enc.hopMs += ms;
      if (enc.nextHopMs <= 0) {
        enc.hopMs = 0;
        enc.nextHopMs = lerp(tcfg.encounterHopMinMs, tcfg.encounterHopMaxMs, Math.random());
      }
      const t = enc.hopMs / tcfg.encounterHopMs;
      const air = t < 1 ? Math.sin(Math.PI * t) : 0;
      const f = tcfg.encounterStretch * air;
      const shy = Math.sin(enc.ageMs / tcfg.encounterShyMs * Math.PI * 2) * tcfg.encounterShyPx * scale;
      const view = enc.actor.view;
      view.scale.set(scale * enc.k * (1 - f * 0.5), scale * enc.k * (1 + f));
      view.position.set(Math.round(ex + shy), Math.round(ey - tcfg.encounterHopPx * scale * air));
      view.zIndex = ey;
      view.alpha = tcfg.encounterAlpha * clamp01(enc.ageMs / tcfg.encounterFadeMs);
      enc.actor.play('idle', place.face);
      enc.actor.update(ticker);
      if (enc.shadow) enc.shadow.groundY = ey;
      if (enc.mythicFx) updateMythicFx(enc, ex, ey);
    }
    // The trap sits beside the monster (its own picture if the encounter has gone but the trap is still set).
    const trap = state.taming?.traps?.[zoneId] || null;
    if (!trap) removeTrap();
    else {
      if (!trapSprite) {
        const tex = bank.texture('prop.trap');
        if (tex) {
          trapSprite = new Sprite(tex);
          const [ax, ay] = bank.anchor('prop.trap');
          trapSprite.anchor.set(ax, ay);
          world.addChild(trapSprite);
          trapShadow = polish.addShadow(trapSprite, tex.width * data.balance.render.polish.shadow.propWidthFrac);
        }
      }
      if (trapSprite) {
        trapAgeMs += ms;
        const pulse = 1 + tcfg.trapPulseAmp * Math.sin(trapAgeMs / tcfg.trapPulseMs * Math.PI * 2);
        const tx = ex + tcfg.trapDx * scale;
        const ty = ey + tcfg.trapDy * scale;
        trapSprite.scale.set(scale * pulse);
        trapSprite.position.set(Math.round(tx), Math.round(ty));
        trapSprite.zIndex = ty;
      }
    }
    // The dig site shows while the player digs here or the zone has a map waiting.
    if (digProp) {
      const t = state.workers.player?.task;
      digProp.sprite.visible = (t?.zone === zoneId && t.skill === 'treasure') || mapCount(state, data, zoneId) > 0;
    }
  }

  function renderWorker(m, state, task, ms, ticker) {
    m.bounceMs += ms;
    const view = m.actor.view;
    view.visible = m.mode !== 'away';
    if (!view.visible) return;
    if (m.mode === 'walk') stepWalk(m, ms);
    else if (m.isPlayer) stepTracking(m, task, ms);
    const { bob, sx, sy } = m.isPlayer ? renderPlayer(m, state, task, ticker, ms) : renderPet(m, state, ms, ticker);
    view.scale.set(sx * m.k, sy * m.k);
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
      const em = emoteFor(e, data);
      const who = em && (e.type !== 'harvest' || e.zone === zoneId) && workers.get(em.id);
      if (who && who.mode !== 'away') emotes.show(em.id, em.kind, actorTarget(who, () => workers.get(em.id) !== who || who.mode === 'away'), { force: em.force });
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
    updateTaming(state, ticker.deltaMS, ticker);
    updatePops(ticker.deltaMS);
    updateZs(ticker.deltaMS);
    emotes.update(ticker.deltaMS);
    polish.update(ticker.deltaMS);
  });

  return {
    start() { running = true; app.start(); },
    stop() { running = false; app.stop(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      emotes.destroy();
      sizeWatch.disconnect();
      app.renderer.off('resize', layout);
      polish.destroy();
      app.destroy(true, { children: true });
      glowTex?.destroy(true);
    },
  };
}
