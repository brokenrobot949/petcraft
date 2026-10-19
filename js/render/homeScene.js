// Home scene (PixiJS). Phase 1 test scene: the player and the four starter pets wander on a grass
// field, proving the art casting works. The real homestead arrives in Phase 5.
// Every number (scales, speeds, pauses) comes from data.balance.render.
import { Application, Container, Graphics, TextureSource } from '../../lib/pixi.mjs';
import { loadSprites, createActor } from './sprites.js';

TextureSource.defaultOptions.scaleMode = 'nearest';

const GRASS = 0x5a8a3c;
const GRASS_DARK = 0x4a7432;
const PATH = 0xc7a26b;

const CAST = ['player', 'pet.sprout.hatchling', 'pet.stone.hatchling', 'pet.tide.hatchling', 'pet.wild.hatchling'];

// Rendering-only randomness (not game state), kept in one place.
const rand = {
  between: (a, b) => a + Math.random() * (b - a),
  int: (a, b) => Math.round(a + Math.random() * (b - a)),
  chance: (p) => Math.random() < p,
  pick: (list) => list[Math.floor(Math.random() * list.length)],
};

// Step vector per facing direction.
const STEP = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

export async function createHomeScene(host, data) {
  const cfg = data.balance.render;
  const wander = cfg.wander;

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

  const bank = await loadSprites(data.sprites);

  const ground = new Graphics();
  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(ground, world);

  let scale = cfg.pixelScale;
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  const dirs = bank.directions;
  const agents = CAST.map((roleId) => {
    const dir = rand.pick(dirs);
    const actor = createActor(bank, roleId, { anim: 'idle', dir });
    actor.view.scale.set(scale);
    world.addChild(actor.view);
    return {
      actor,
      isPlayer: roleId === 'player',
      x: 0, y: 0,
      state: 'pause',
      timer: rand.between(wander.minPauseMs, wander.maxPauseMs),
      remaining: 0, // screen pixels left in the current step
      dir,
    };
  });

  function place(agent) {
    agent.x = Math.min(Math.max(agent.x, bounds.minX), bounds.maxX);
    agent.y = Math.min(Math.max(agent.y, bounds.minY), bounds.maxY);
    agent.actor.view.position.set(Math.round(agent.x), Math.round(agent.y));
    agent.actor.view.zIndex = Math.round(agent.y);
  }

  function computeBounds() {
    const w = app.screen.width;
    const h = app.screen.height;
    const probe = agents[0].actor.sprite;
    const halfW = Math.ceil(probe.width * scale / 2); // sprite size in screen pixels
    const spriteH = Math.ceil(probe.height * scale);
    const caption = host.querySelector('.home-caption');
    const captionBottom = caption ? caption.offsetTop + caption.offsetHeight : 0;
    bounds.minX = halfW;
    bounds.maxX = Math.max(halfW, w - halfW);
    bounds.minY = Math.min(captionBottom + spriteH, h); // keep heads clear of the caption
    bounds.maxY = Math.max(bounds.minY, h - spriteH); // margin at the bottom
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

  let firstLayout = true;
  function layout() {
    const w = app.screen.width;
    scale = w >= cfg.wideMinWidthPx ? cfg.pixelScaleWide : cfg.pixelScale; // whole numbers only
    for (const a of agents) a.actor.view.scale.set(scale);
    computeBounds();
    drawGround();
    if (firstLayout) {
      // Spread out: player in the middle, pets around it.
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const dx = (bounds.maxX - bounds.minX) / 3;
      const dy = (bounds.maxY - bounds.minY) / 3;
      const offsets = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      agents.forEach((a, i) => {
        a.x = cx + offsets[i][0] * dx;
        a.y = cy + offsets[i][1] * dy;
      });
      firstLayout = false;
    }
    for (const a of agents) place(a);
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

  layout();
  app.renderer.on('resize', layout);

  app.ticker.add((ticker) => {
    for (const a of agents) {
      step(a, ticker.deltaMS);
      a.actor.update(ticker);
    }
  });

  return {
    start: () => app.start(),
    stop: () => app.stop(),
  };
}
