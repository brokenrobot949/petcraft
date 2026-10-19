// Home scene (PixiJS). The player and the player's real pets wander on a grass field; resting pets
// sleep in place with floating "z"s. The real homestead arrives in Phase 5.
// Read-only: it never changes game state. It listens to the game so a newly hatched pet appears
// without reloading. Every number (scales, speeds, pauses, z's) comes from data.balance.render.
import { Application, Container, Graphics, Text, TextureSource } from '../../lib/pixi.mjs';
import { loadSprites, createActor } from './sprites.js';
import { petStatus } from '../systems/pets.js';
import { petRole } from '../systems/petstats.js';

TextureSource.defaultOptions.scaleMode = 'nearest';

const GRASS = 0x5a8a3c;
const GRASS_DARK = 0x4a7432;
const PATH = 0xc7a26b;

// Rendering-only randomness (not game state), kept in one place.
const rand = {
  between: (a, b) => a + Math.random() * (b - a),
  int: (a, b) => Math.round(a + Math.random() * (b - a)),
  chance: (p) => Math.random() < p,
  pick: (list) => list[Math.floor(Math.random() * list.length)],
};

// Step vector per facing direction.
const STEP = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

const easeOutRise = (t) => 1 - (1 - t) * (1 - t);

export async function createHomeScene(host, game) {
  const data = game.data;
  const cfg = data.balance.render;
  const wander = cfg.wander;
  const hcfg = cfg.home;
  const colorOf = (v) => Number(v); // balance.json stores colors as "0xrrggbb" strings

  const app = new Application();
  await app.init({
    resizeTo: host,
    background: GRASS,
    antialias: false,
    roundPixels: true,
    resolution: Math.min(window.devicePixelRatio || 1, cfg.maxResolution),
    autoDensity: true,
  });
  host.append(app.canvas);
  try { await document.fonts.load(`${hcfg.zFontSize}px NormalFont`); } catch { /* fall back to the default font */ }

  const bank = await loadSprites(data.sprites);

  const ground = new Graphics();
  const world = new Container();
  world.sortableChildren = true;
  const fx = new Container();
  app.stage.addChild(ground, world, fx);

  let scale = cfg.pixelScale;
  let destroyed = false;
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const dirs = bank.directions;
  const agents = new Map(); // id ('player' or a pet id) -> agent

  function place(agent) {
    agent.x = Math.min(Math.max(agent.x, bounds.minX), bounds.maxX);
    agent.y = Math.min(Math.max(agent.y, bounds.minY), bounds.maxY);
    agent.actor.view.position.set(Math.round(agent.x), Math.round(agent.y));
    agent.actor.view.zIndex = Math.round(agent.y);
  }

  function computeBounds() {
    const w = app.screen.width;
    const h = app.screen.height;
    const probe = agents.get('player').actor.sprite;
    const halfW = Math.ceil(probe.width * scale / 2); // sprite size in screen pixels
    const spriteH = Math.ceil(probe.height * scale);
    const caption = host.querySelector('.home-caption');
    const captionBottom = caption ? caption.offsetTop + caption.offsetHeight : 0;
    bounds.minX = halfW;
    bounds.maxX = Math.max(halfW, w - halfW);
    bounds.minY = Math.min(captionBottom + spriteH, h); // keep heads clear of the caption
    bounds.maxY = Math.max(bounds.minY, h - spriteH); // margin at the bottom
  }

  function addAgent(id, roleId) {
    const dir = rand.pick(dirs);
    const actor = createActor(bank, roleId, { anim: 'idle', dir });
    actor.view.scale.set(scale);
    world.addChild(actor.view);
    const agent = {
      id, roleId, actor,
      isPlayer: id === 'player',
      x: 0, y: 0,
      state: 'pause',
      timer: rand.between(wander.minPauseMs, wander.maxPauseMs),
      remaining: 0, // screen pixels left in the current step
      dir,
      sleeping: false,
      zMs: 0,
    };
    // The player starts in the middle; pets start anywhere in the field.
    agent.x = agent.isPlayer ? (bounds.minX + bounds.maxX) / 2 : rand.between(bounds.minX, bounds.maxX);
    agent.y = agent.isPlayer ? (bounds.minY + bounds.maxY) / 2 : rand.between(bounds.minY, bounds.maxY);
    agents.set(id, agent);
    place(agent);
    return agent;
  }

  // Keep the cast equal to the player plus every pet in the save (new hatchlings appear live).
  function syncAgents() {
    if (destroyed) return;
    const state = game.getState();
    const pets = state.pets.list;
    for (const [id, a] of [...agents]) {
      if (id === 'player') continue;
      if (!pets[id] || petRole(pets[id]) !== a.roleId) { a.actor.destroy(); agents.delete(id); }
    }
    for (const id of Object.keys(pets)) {
      if (!agents.has(id)) addAgent(id, petRole(pets[id]));
    }
  }

  function drawGround() {
    const w = app.screen.width;
    const h = app.screen.height;
    ground.clear();
    // Checker of grass tiles at the pixel scale, plus a dirt path down the middle.
    const tile = cfg.tilePx * scale; // one pack tile
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        if (((x / tile) + (y / tile)) % 2 === 0) ground.rect(x, y, tile, tile).fill(GRASS_DARK);
      }
    }
    ground.rect(Math.floor(w / 2 / tile) * tile, 0, tile, h).fill(PATH);
  }

  function layout() {
    const w = app.screen.width;
    scale = w >= cfg.wideMinWidthPx ? cfg.pixelScaleWide : cfg.pixelScale; // whole numbers only
    for (const a of agents.values()) a.actor.view.scale.set(scale);
    computeBounds();
    drawGround();
    for (const a of agents.values()) place(a);
  }

  function startPause(agent) {
    agent.state = 'pause';
    agent.timer = rand.between(wander.minPauseMs, wander.maxPauseMs);
    if (agent.isPlayer && rand.chance(wander.swingChance)) {
      agent.timer = wander.swingMs;
      agent.actor.play('swing', agent.dir);
    } else {
      agent.actor.play('idle', agent.dir);
    }
  }

  function startWalk(agent) {
    agent.dir = rand.pick(dirs);
    agent.remaining = rand.int(wander.minStepPx, wander.maxStepPx) * scale;
    agent.state = 'walk';
    agent.actor.play('walk', agent.dir);
  }

  function step(agent, ms) {
    if (agent.state === 'pause') {
      agent.timer -= ms;
      if (agent.timer <= 0) startWalk(agent);
      return;
    }
    const [vx, vy] = STEP[agent.dir];
    const dist = Math.min(agent.remaining, wander.walkSpeedPxPerSec * scale * ms / 1000);
    const nx = agent.x + vx * dist;
    const ny = agent.y + vy * dist;
    const blocked = nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY;
    agent.x = nx;
    agent.y = ny;
    agent.remaining -= dist;
    place(agent);
    if (blocked || agent.remaining <= 0) startPause(agent);
  }

  // ---- floating z's for sleeping pets ----
  const zs = []; // { t, age, x0, y0, phase }
  function addZ(agent) {
    if (zs.length >= hcfg.maxZ) zs.shift().t.destroy();
    const t = new Text({
      text: 'z',
      style: {
        fontFamily: 'NormalFont',
        fontSize: hcfg.zFontSize,
        fill: colorOf(hcfg.zColor),
        stroke: { color: 0x2a2433, width: 3, join: 'round' },
      },
    });
    t.anchor.set(0.5);
    fx.addChild(t);
    zs.push({
      t, age: 0, phase: Math.random() * Math.PI * 2,
      x0: agent.x + hcfg.zOffsetXPx * scale,
      y0: agent.y - hcfg.zOffsetYPx * scale,
    });
  }
  function updateZs(ms) {
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      z.age += ms;
      const k = z.age / hcfg.zRiseMs;
      if (k >= 1) { z.t.destroy(); zs.splice(i, 1); continue; }
      z.t.position.set(
        Math.round(z.x0 + Math.sin(z.phase + k * Math.PI * 2) * hcfg.zSwayPx * scale),
        Math.round(z.y0 - easeOutRise(k) * hcfg.zRisePx * scale));
      z.t.alpha = 1 - k;
    }
  }

  // The player must exist before the first layout (bounds are measured from its sprite).
  addAgent('player', 'player');
  layout();
  syncAgents();
  const unsubscribe = game.subscribe(syncAgents);
  app.renderer.on('resize', layout);

  app.ticker.add((ticker) => {
    const state = game.getState();
    for (const a of agents.values()) {
      const asleep = !a.isPlayer && petStatus(state, a.id) === 'resting';
      if (asleep) {
        if (!a.sleeping) {
          a.sleeping = true;
          a.state = 'pause';
          a.actor.play('idle', a.dir);
          a.actor.sprite.gotoAndStop(hcfg.restFrame);
        }
        a.zMs += ticker.deltaMS;
        if (a.zMs >= hcfg.zIntervalMs) { a.zMs = 0; addZ(a); }
        continue;
      }
      if (a.sleeping) {
        a.sleeping = false;
        a.zMs = 0;
        a.actor.sprite.play();
        startPause(a);
      }
      step(a, ticker.deltaMS);
      a.actor.update(ticker);
    }
    updateZs(ticker.deltaMS);
  });

  return {
    start: () => { syncAgents(); app.start(); },
    stop: () => app.stop(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      app.renderer.off('resize', layout);
      app.destroy(true, { children: true });
    },
  };
}
