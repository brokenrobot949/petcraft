// Home scene (PixiJS): the homestead. Every building from data/buildings.json stands on its plot
// (tier 0 = an empty plot), with decor (the Old Sanctuary ruins, the signpost). Tapping a building or a
// decor piece calls options.onTap({ kind: 'building', id } | { kind: 'decor', prop, label }), and tapping a pet
// calls options.onTap({ kind: 'pet', id }) (Phase 11: pat, play, tuck in). The player
// and every pet that is not out working wander on open ground (never through a building); resting pets
// sleep with floating "z"s; emote bubbles pop up over pets (js/render/emotes.js), and a pat or a game makes
// the pet hop. A bobbing arrow marks buildings that can be upgraded; a tier change swaps
// the picture with a squash-and-stretch pop and a burst of sparkles.
// Read-only: it never changes game state. Every number comes from data.balance.render.home / .polish.
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureSource } from '../../lib/pixi.mjs';
import { loadSprites, createActor } from './sprites.js';
import { createPolish } from './polish.js';
import { createEmotes, emoteFor, actorTarget } from './emotes.js';
import { petStatus } from '../systems/pets.js';
import { petRole } from '../systems/petstats.js';
import { upgradeCheck, buildingTier } from '../systems/buildings.js';

TextureSource.defaultOptions.scaleMode = 'nearest';

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
const colorOf = (v) => Number(v); // balance.json stores colors as "0xrrggbb" strings
const css = (n) => `#${n.toString(16).padStart(6, '0')}`;

function drawn(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = Texture.from(c);
  tex.source.scaleMode = 'nearest';
  return tex;
}

// options.onTap(target): see the top of the file.
export async function createHomeScene(host, game, options = {}) {
  const { onTap } = options;
  const data = game.data;
  const cfg = data.balance.render;
  const wander = cfg.wander;
  const hcfg = cfg.home;
  const pcfg = cfg.polish;
  const defs = data.buildings.buildings;
  const decorDefs = data.buildings.decor || [];
  const scfg = hcfg.projectScene;
  // Mythic pets are big boss strips: drawn at render.mythicScale of the scene's pixel scale.
  const roleK = (roleId) => (roleId.startsWith('mythic.') ? cfg.mythicScale : 1);

  const app = new Application();
  await app.init({
    resizeTo: host,
    background: colorOf(hcfg.grassColor),
    antialias: false,
    roundPixels: true,
    resolution: Math.min(window.devicePixelRatio || 1, cfg.maxResolution),
    autoDensity: true,
  });
  host.append(app.canvas);
  // Taps on buildings are handled; a drag that starts on the picture still scrolls the page.
  app.renderer.events.autoPreventDefault = false;
  app.canvas.style.touchAction = 'pan-y';
  try { await document.fonts.load(`${hcfg.zFontSize}px NormalFont`); } catch { /* fall back to the default font */ }

  const bank = await loadSprites(data.sprites);

  const ground = new Graphics();
  const world = new Container();
  world.sortableChildren = true;
  const fx = new Container();
  const polish = createPolish(app, { cfg: pcfg, bank });
  app.stage.addChild(ground, polish.shadows, world, polish.air, polish.tint, fx, polish.top);
  const emotes = createEmotes(fx, bank, cfg.emotes);

  let scale = hcfg.pixelScale;
  let running = false;
  let destroyed = false;
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const dirs = bank.directions;
  const agents = new Map(); // id ('player' or a pet id) -> agent
  const owned = []; // code-drawn textures

  // ---- code-drawn textures ----
  const arrowTex = drawn(7, 9, (g) => {
    const edge = css(colorOf(hcfg.markerEdgeColor));
    const fill = css(colorOf(hcfg.markerColor));
    g.fillStyle = edge;
    g.fillRect(3, 0, 1, 1); g.fillRect(2, 1, 3, 1); g.fillRect(1, 2, 5, 1); g.fillRect(0, 3, 7, 1);
    g.fillRect(2, 4, 3, 5);
    g.fillStyle = fill;
    g.fillRect(3, 1, 1, 1); g.fillRect(2, 2, 3, 1); g.fillRect(1, 3, 5, 1);
    g.fillRect(3, 4, 1, 4);
  });
  const sparkFrames = [];
  for (let i = 0; i < 12; i++) {
    const t = bank.texture('fx.sparkle', 'idle', i);
    if (!t) break;
    sparkFrames.push(t);
  }
  const sparkTex = sparkFrames.length ? sparkFrames : [drawn(5, 5, (g) => {
    g.fillStyle = css(colorOf(hcfg.sparkColor));
    g.fillRect(2, 0, 1, 5); g.fillRect(0, 2, 5, 1);
  })];
  owned.push(arrowTex, ...(sparkFrames.length ? [] : sparkTex));

  // Stand-ins for pictures that are not cast yet (a plain house block / a dirt plot).
  const placeholders = new Map();
  function placeholderTex(index, tier) {
    const key = `${index}:${tier}`;
    if (placeholders.has(key)) return placeholders.get(key);
    const col = colorOf(hcfg.placeholderColors[index % hcfg.placeholderColors.length]);
    const w = hcfg.placeholderBasePx + hcfg.placeholderPerTierPx * tier;
    let tex;
    if (tier === 0) {
      tex = drawn(w, Math.round(w / 2), (g, cw, ch) => {
        g.fillStyle = '#a88650'; g.fillRect(0, 2, cw, ch - 2);
        g.fillStyle = '#c7a26b'; g.fillRect(2, 4, cw - 4, ch - 6);
      });
    } else {
      tex = drawn(w, w, (g, cw, ch) => {
        g.fillStyle = css(col); g.fillRect(0, Math.round(ch / 3), cw, ch - Math.round(ch / 3));
        g.fillStyle = '#4a3a32'; g.fillRect(0, 0, cw, Math.round(ch / 3));
        g.fillStyle = '#2a2433'; g.fillRect(Math.round(cw / 2) - 3, ch - 8, 6, 8);
      });
    }
    placeholders.set(key, tex);
    owned.push(tex);
    return tex;
  }

  // ---- buildings and decor ----
  // piece = { kind, id|prop, fx, fy, sprite, shadow, tier, role, pop, marker, label, tex }
  const pieces = [];
  const buildings = new Map();

  function textureFor(p) {
    if (p.kind === 'building') {
      const t = bank.texture(`building.${p.id}.${p.tier}`) ||
        (p.tier === 0 ? bank.texture('prop.plot_empty') : null);
      return t || placeholderTex(p.index, p.tier);
    }
    if (p.prop === 'sanctuary_ruins') return sanctuaryTex(p.count) || placeholderTex(p.index + 3, 1);
    return bank.texture(`prop.${p.prop}`) || placeholderTex(p.index + 3, 1);
  }

  // The Old Sanctuary: prop.sanctuary.<n> for n finished projects, else the highest lower n, else the ruins.
  function sanctuaryTex(n) {
    for (let i = n; i >= 1; i--) {
      const t = bank.texture(`prop.sanctuary.${i}`);
      if (t) return t;
    }
    return bank.texture('prop.sanctuary_ruins');
  }
  const doneCount = (state) => state.sanctuary?.done?.length || 0;

  function makePiece(kind, def, index) {
    const p = {
      kind, index, fx: def.plot[0], fy: def.plot[1], label: def.label || def.name,
      id: def.id, prop: def.prop, tier: kind === 'building' ? buildingTier(game.getState(), def.id) : 1,
      pop: -1, marker: null, tex: null, rect: null,
      show: def.show || null,
      count: kind === 'decor' && def.prop === 'sanctuary_ruins' ? doneCount(game.getState()) : 0,
    };
    p.sprite = new Sprite(textureFor(p));
    p.sprite.anchor.set(0.5, 1);
    p.tex = p.sprite.texture;
    p.sprite.eventMode = 'static';
    p.sprite.cursor = 'pointer';
    p.sprite.on('pointertap', () => {
      if (!running || destroyed || !onTap || !p.sprite.visible) return;
      onTap(kind === 'building' ? { kind, id: p.id } : { kind, prop: p.prop, label: p.label });
    });
    world.addChild(p.sprite);
    p.shadow = polish.addShadow(p.sprite, 1);
    if (kind === 'building') {
      p.marker = new Sprite(arrowTex);
      p.marker.anchor.set(0.5, 1);
      p.marker.visible = false;
      fx.addChild(p.marker);
      buildings.set(def.id, p);
    }
    pieces.push(p);
    return p;
  }
  defs.forEach((d, i) => makePiece('building', d, i));
  decorDefs.forEach((d, i) => makePiece('decor', d, i));
  const sanctuary = pieces.find((p) => p.kind === 'decor' && p.prop === 'sanctuary_ruins') || null;
  const grove = pieces.find((p) => p.kind === 'decor' && p.show === 'grove') || null;
  if (grove) grove.sprite.visible = !!game.getState().elders?.open;

  function sizePiece(p) {
    const tex = p.sprite.texture;
    p.tex = tex;
    const [x, y] = [Math.round(p.fx * app.screen.width), Math.round(p.fy * app.screen.height)];
    p.x = x;
    p.y = y;
    p.sprite.scale.set(scale);
    p.sprite.position.set(x, y);
    p.sprite.zIndex = y;
    // Tap area at least tapMinPx across (screen px), however small the picture.
    const min = hcfg.tapMinPx / scale;
    const w = Math.max(tex.width, min);
    const h = Math.max(tex.height, min);
    p.sprite.hitArea = new Rectangle(-w / 2, -(tex.height + h) / 2, w, h);
    p.shadow.w = tex.width * (p.kind === 'building' ? hcfg.footprintWidthFrac : pcfg.shadow.propWidthFrac);
    // Keep-out rectangle (screen px): the whole picture plus a margin, so nobody walks behind it.
    const halfW = tex.width * scale * hcfg.footprintWidthFrac / 2;
    const pad = hcfg.keepOutPadPx * scale;
    p.rect = { x0: x - halfW - pad, x1: x + halfW + pad, y0: y - tex.height * scale - pad, y1: y + pad };
    if (!p.sprite.visible) p.rect = null; // a hidden piece (the Elder Grove before it opens) blocks nobody
  }

  // ---- upgrade markers, tier changes, sparkles ----
  const sparks = []; // { s, age, vx, vy, x0, y0 }
  const freeSparks = [];
  function burst(p) {
    const n = hcfg.popSparks;
    const cx = p.x;
    const cy = p.y - (p.tex.height * scale) / 2;
    for (let i = 0; i < n; i++) {
      let sp = freeSparks.pop();
      if (!sp) {
        if (sparks.length >= hcfg.maxSparks) break;
        sp = { s: new Sprite(sparkTex[0]), age: 0 };
        sp.s.anchor.set(0.5);
        fx.addChild(sp.s);
      }
      const ang = (i / n) * Math.PI * 2 + Math.random();
      sp.age = 0;
      sp.shower = false;
      sp.life = hcfg.sparkMs;
      sp.vx = Math.cos(ang);
      sp.vy = Math.sin(ang);
      sp.x0 = cx + (Math.random() - 0.5) * p.tex.width * scale * 0.5;
      sp.y0 = cy;
      sp.s.texture = sparkTex[i % sparkTex.length];
      sp.s.scale.set(scale);
      sp.s.visible = true;
      sparks.push(sp);
    }
  }
  // One rising sparkle at the Sanctuary (the project scene's shower).
  function spawnRiser(p) {
    let sp = freeSparks.pop();
    if (!sp) {
      if (sparks.length >= hcfg.maxSparks + scfg.showerMaxSparks) return;
      sp = { s: new Sprite(sparkTex[0]), age: 0 };
      sp.s.anchor.set(0.5);
      fx.addChild(sp.s);
    }
    sp.age = 0;
    sp.shower = true;
    sp.life = scfg.showerSparkMs;
    sp.phase = Math.random() * Math.PI * 2;
    sp.x0 = p.x + (Math.random() - 0.5) * scfg.showerSpreadPx * 2 * scale;
    sp.y0 = p.y - Math.random() * p.tex.height * scale * 0.5;
    sp.s.texture = sparkTex[Math.floor(Math.random() * sparkTex.length)];
    sp.s.scale.set(scale);
    sp.s.visible = true;
    sparks.push(sp);
  }
  function updateSparks(ms) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i];
      sp.age += ms;
      const k = sp.age / sp.life;
      if (k >= 1) {
        sp.s.visible = false;
        sparks.splice(i, 1);
        freeSparks.push(sp);
        continue;
      }
      if (sp.shower) {
        // A rising sparkle: drifts up and sways, fades out at the top.
        sp.s.position.set(Math.round(sp.x0 + Math.sin(sp.phase + k * Math.PI * 2) * 4 * scale),
          Math.round(sp.y0 - easeOutRise(k) * scfg.showerRisePx * scale));
        sp.s.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        continue;
      }
      const d =easeOutRise(k) * hcfg.sparkSpreadPx * scale;
      sp.s.position.set(Math.round(sp.x0 + sp.vx * d), Math.round(sp.y0 + sp.vy * d - k * hcfg.sparkRisePx * scale));
      sp.s.alpha = 1 - k * k;
    }
  }

  function swapTier(p, tier, animate) {
    p.tier = tier;
    p.sprite.texture = textureFor(p);
    sizePiece(p);
    layoutMarker(p);
    if (animate) { p.pop = 0; burst(p); }
  }
  function syncTiers(animate) {
    const state = game.getState();
    for (const p of buildings.values()) {
      const t = buildingTier(state, p.id);
      if (t !== p.tier) swapTier(p, t, animate);
    }
  }

  let markerMs = Infinity;
  function refreshMarkers() {
    const state = game.getState();
    for (const p of buildings.values()) p.marker.visible = upgradeCheck(state, data, p.id).ok;
  }
  function layoutMarker(p) {
    if (!p.marker) return;
    p.marker.scale.set(scale);
    p.markerY = p.y - p.tex.height * scale - hcfg.markerGapPx * scale;
    p.marker.position.x = p.x;
    p.marker.zIndex = p.y;
  }
  function updatePieces(ms, clock) {
    for (const p of pieces) {
      if (p.pop >= 0) {
        p.pop += ms;
        const k = p.pop / hcfg.popMs;
        if (k >= 1) { p.pop = -1; p.sprite.scale.set(scale); } else {
          const f = hcfg.popAmp * Math.sin(k * Math.PI * 2 * hcfg.popCycles) * (1 - k);
          p.sprite.scale.set(scale * (1 + f * 0.6), scale * (1 - f));
        }
      }
      if (p.marker?.visible) {
        const bob = Math.sin(clock / hcfg.markerBobMs * Math.PI * 2) * hcfg.markerBobPx * scale;
        p.marker.position.y = Math.round(p.markerY + bob);
      }
    }
  }

  // ---- ground ----
  function drawGround() {
    const w = app.screen.width;
    const h = app.screen.height;
    ground.clear();
    // Checker of darker grass tiles at the pixel scale.
    const tile = cfg.tilePx * scale;
    const dark = colorOf(hcfg.grassDark);
    for (let y = 0; y < h; y += tile) {
      for (let x = 0; x < w; x += tile) {
        if (((x / tile) + (y / tile)) % 2 === 0) ground.rect(x, y, tile, tile).fill(dark);
      }
    }
    // Dirt paths between plots: axis-aligned segments with a darker edge.
    const pw = hcfg.pathWidthPx * scale;
    const edge = scale;
    for (const pass of [0, 1]) {
      const col = colorOf(pass === 0 ? hcfg.pathEdgeColor : hcfg.pathColor);
      const grow = pass === 0 ? edge : 0;
      for (const line of hcfg.paths) {
        for (let i = 0; i + 1 < line.length; i++) {
          const ax = Math.round(line[i][0] * w);
          const ay = Math.round(line[i][1] * h);
          const bx = Math.round(line[i + 1][0] * w);
          const by = Math.round(line[i + 1][1] * h);
          const x0 = Math.min(ax, bx) - pw / 2 - grow;
          const y0 = Math.min(ay, by) - pw / 2 - grow;
          ground.rect(x0, y0, Math.abs(bx - ax) + pw + grow * 2, Math.abs(by - ay) + pw + grow * 2).fill(col);
        }
      }
    }
  }

  // ---- characters ----
  const blockedBy = (x, y) => {
    for (const p of pieces) {
      const r = p.rect;
      if (r && x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return r;
    }
    return null;
  };
  const outside = (x, y) => x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY;

  function computeBounds() {
    const w = app.screen.width;
    const h = app.screen.height;
    const probe = agents.get('player').actor.sprite;
    const halfW = Math.ceil(probe.width * scale / 2);
    const spriteH = Math.ceil(probe.height * scale);
    const m = hcfg.edgeMarginPx * scale;
    bounds.minX = halfW + m;
    bounds.maxX = Math.max(bounds.minX, w - halfW - m);
    bounds.minY = Math.min(spriteH + m, h);
    bounds.maxY = Math.max(bounds.minY, h - m);
  }

  function petAnchor(agent) {
    if (agent?.wild && sanctuary) return { x: sanctuary.x, y: sanctuary.y + scfg.gatherDropPx * scale };
    const stable = buildings.get('stable') || pieces[0];
    return { x: stable.x, y: stable.y + hcfg.petAnchorDropPx * scale };
  }

  // Put an agent at a free spot: near (x, y), pushing it out of any building it overlaps.
  function settle(agent) {
    agent.x = Math.min(Math.max(agent.x, bounds.minX), bounds.maxX);
    agent.y = Math.min(Math.max(agent.y, bounds.minY), bounds.maxY);
    for (let guard = 0; guard < pieces.length + 1; guard++) {
      const r = blockedBy(agent.x, agent.y);
      if (!r) break;
      agent.y = Math.min(r.y1 + 1, bounds.maxY); // out the front of the building
      if (blockedBy(agent.x, agent.y)) agent.x = r.x1 + 1 > bounds.maxX ? r.x0 - 1 : r.x1 + 1;
    }
    place(agent);
  }

  function place(agent) {
    agent.actor.view.position.set(Math.round(agent.x), Math.round(agent.y));
    agent.actor.view.zIndex = Math.round(agent.y);
  }

  function randomSpot(agent) {
    const a = petAnchor(agent);
    const R = hcfg.petWanderRadiusPx * scale;
    for (let i = 0; i < 20; i++) {
      const x = agent.isPlayer ? rand.between(bounds.minX, bounds.maxX) : a.x + rand.between(-R, R);
      const y = agent.isPlayer ? rand.between(bounds.minY, bounds.maxY) : a.y + rand.between(-R, R);
      if (!outside(x, y) && !blockedBy(x, y)) { agent.x = x; agent.y = y; return; }
    }
    agent.x = a.x; agent.y = a.y;
  }

  // The station an assistant pet works at, or null (state.crafting.assists = { stationId: petId }).
  function postOf(state, petId) {
    const assists = state.crafting?.assists;
    if (!assists) return null;
    for (const st in assists) if (assists[st] === petId && buildings.has(st)) return st;
    return null;
  }

  // Stand just to the side of the station (right, or left if the right is off screen), facing it.
  function postSpot(agent) {
    const b = buildings.get(agent.post);
    if (!b || !b.rect) return;
    const gap = hcfg.assistSideGapPx * scale;
    let right = true;
    let x = b.rect.x1 + gap;
    if (x > bounds.maxX) { right = false; x = b.rect.x0 - gap; }
    agent.x = Math.min(Math.max(x, bounds.minX), bounds.maxX);
    agent.y = Math.min(Math.max(b.y, bounds.minY), bounds.maxY);
    agent.dir = right ? 'left' : 'right';
    agent.state = 'pause';
    agent.actor.play('idle', agent.dir);
    place(agent);
  }

  // Shadow width (sprite units) for a character: mythic bosses are much bigger than a pet.
  function shadowWidth(actor, k) {
    return k === 1 ? hcfg.shadowCharacterWidthPx : Math.max(hcfg.shadowCharacterWidthPx, actor.sprite.texture.width * k * cfg.mythicShadowFrac);
  }

  function addAgent(id, roleId, post = null, wild = false) {
    const dir = rand.pick(dirs);
    const actor = createActor(bank, roleId, { anim: 'idle', dir });
    const k = roleK(roleId);
    actor.view.scale.set(scale * k);
    world.addChild(actor.view);
    const agent = {
      id, roleId, actor, post, k, wild, goal: null,
      workMs: 0,
      isPlayer: id === 'player',
      x: 0, y: 0,
      state: 'pause',
      timer: rand.between(wander.minPauseMs, wander.maxPauseMs),
      remaining: 0, // screen pixels left in the current step
      dir,
      sleeping: false,
      zMs: 0,
      hopMs: -1,
      shadow: polish.addShadow(actor.view, shadowWidth(actor, k)),
    };
    agents.set(id, agent);
    if (id !== 'player' && !wild) {
      actor.view.eventMode = 'static';
      actor.view.cursor = 'pointer';
      petHitArea(agent);
      actor.view.on('pointertap', () => {
        if (!running || destroyed || !onTap || !agents.has(id)) return;
        onTap({ kind: 'pet', id });
      });
    }
    if (bounds.maxX > 0) {
      if (post) postSpot(agent); else { randomSpot(agent); settle(agent); }
    }
    return agent;
  }
  // A pet's tap target: its body, grown to at least tapMinPx on screen (pets are only 16 px).
  function petHitArea(agent) {
    const sp = agent.actor.sprite;
    const w = sp.texture.width;
    const h = sp.texture.height;
    const min = hcfg.tapMinPx / (scale * agent.k);
    const hw = Math.max(w, min);
    const hh = Math.max(h, min);
    agent.actor.view.hitArea = new Rectangle(-hw / 2, -h * sp.anchor.y - (hh - h) / 2, hw, hh);
  }
  function removeAgent(id) {
    const a = agents.get(id);
    if (!a) return;
    emotes.clear(id);
    a.shadow.remove();
    a.actor.destroy();
    agents.delete(id);
  }

  // Keep the cast equal to the player plus every pet that is home (not out working).
  function syncAgents() {
    if (destroyed) return;
    const state = game.getState();
    const pets = state.pets.list;
    for (const id of [...agents.keys()]) {
      if (id === 'player') continue;
      const a = agents.get(id);
      if (a.wild) continue; // wild visitors from the ending scene are not pets in the save
      // Rebuilt when the pet leaves, goes out working, evolves (a different sprite role) or its post changes.
      if (!pets[id] || petRole(pets[id]) !== a.roleId || a.post !== postOf(state, id) || petStatus(state, id) === 'working') removeAgent(id);
    }
    for (const id of Object.keys(pets)) {
      if (!agents.has(id) && petStatus(state, id) !== 'working') addAgent(id, petRole(pets[id]), postOf(state, id));
    }
  }

  function layout() {
    const w = app.screen.width;
    scale = w >= hcfg.wideMinWidthPx ? hcfg.pixelScaleWide : hcfg.pixelScale; // whole numbers only
    polish.resize(w, app.screen.height, scale);
    for (const p of pieces) { sizePiece(p); layoutMarker(p); }
    for (const a of agents.values()) {
      a.actor.view.scale.set(scale * a.k);
      if (a.actor.view.hitArea) petHitArea(a);
    }
    for (const e of elders) e.actor.view.scale.set(scale * e.k);
    computeBounds();
    drawGround();
    placeElders();
    for (const a of agents.values()) {
      a.remaining = 0;
      if (a.post) postSpot(a); else settle(a);
    }
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
    if (!agent.isPlayer) {
      // Pets drift back toward the Stable when they stray too far from it.
      const a = petAnchor(agent);
      const dx = a.x - agent.x;
      const dy = a.y - agent.y;
      if (Math.hypot(dx, dy) > hcfg.petWanderRadiusPx * scale) {
        agent.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      }
    }
    agent.remaining = rand.int(wander.minStepPx, wander.maxStepPx) * scale;
    agent.state = 'walk';
    agent.actor.play('walk', agent.dir);
  }

  function step(agent, ms) {
    if (agent.state === 'pause') {
      agent.timer -= ms;
      if (!agent.isPlayer && agent.hopMs < 0 && rand.chance(hcfg.hopChancePerSec * ms / 1000)) agent.hopMs = 0;
      if (agent.timer <= 0) startWalk(agent);
      return;
    }
    const [vx, vy] = STEP[agent.dir];
    const dist = Math.min(agent.remaining, wander.walkSpeedPxPerSec * scale * ms / 1000);
    const nx = agent.x + vx * dist;
    const ny = agent.y + vy * dist;
    if (outside(nx, ny) || blockedBy(nx, ny)) { startPause(agent); return; }
    agent.x = nx;
    agent.y = ny;
    agent.remaining -= dist;
    place(agent);
    if (agent.remaining <= 0) startPause(agent);
  }

  // A small hop with squash-and-stretch; the shadow stays on the ground (the sprite moves, not the view).
  function updateHop(a, ms) {
    const view = a.actor.view;
    if (a.hopMs < 0) return;
    a.hopMs += ms;
    const t = a.hopMs / hcfg.hopMs;
    if (t >= 1) { a.hopMs = -1; a.actor.sprite.y = 0; view.scale.set(scale * a.k); return; }
    const air = Math.sin(Math.PI * t);
    const land = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - hcfg.hopLandFrac) / (1 - hcfg.hopLandFrac))));
    const f = hcfg.hopStretch * air - hcfg.hopSquash * land;
    a.actor.sprite.y = -hcfg.hopPx * air;
    view.scale.set(scale * a.k * (1 - f * 0.5), scale * a.k * (1 + f));
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

  // ---- Old Sanctuary restoration look ----
  let activeScene = null; // the running project scene (see playProjectScene), or null
  let holdMs = 0;
  function swapSanctuary(count, animate) {
    if (!sanctuary) return;
    sanctuary.count = count;
    sanctuary.sprite.texture = textureFor(sanctuary);
    sizePiece(sanctuary);
    if (animate) { sanctuary.pop = 0; burst(sanctuary); }
  }
  // Follows state.sanctuary.done. While a scene is playing (or just waiting to be played) the new look is held
  // back so the scene can reveal it at its climax; if nobody plays it within holdMs it swaps on its own.
  function syncSanctuary(animate, ms = 0) {
    if (!sanctuary) return;
    const state = game.getState();
    const n = doneCount(state);
    if (n === sanctuary.count) { holdMs = 0; return; }
    if (animate && (activeScene || (state.sanctuary?.scenes?.length && holdMs < scfg.holdMs))) { holdMs += ms; return; }
    holdMs = 0;
    swapSanctuary(n, animate);
  }

  // ---- Elder Grove: visible only once the Grove has opened; retired pets stand beside it ----
  function syncGrove(animate) {
    if (!grove) return;
    const open = !!game.getState().elders?.open;
    if (grove.sprite.visible === open) return;
    grove.sprite.visible = open;
    sizePiece(grove);
    if (open && animate) { grove.pop = 0; burst(grove); }
    placeElders();
  }

  const elders = []; // agent-like: { id, roleId, actor, k, shadow, x, y, hopMs, sleeping, zMs, napMs }
  let elderSig = '';
  function placeElders() {
    if (!grove?.rect) return;
    const gap = hcfg.elderGapPx * scale;
    const spacing = hcfg.elderSpacingPx * scale;
    elders.forEach((e, i) => {
      const left = i % 2 === 0;
      const x = left ? grove.rect.x0 - gap - Math.floor(i / 2) * spacing : grove.rect.x1 + gap + Math.floor(i / 2) * spacing;
      e.x = Math.min(Math.max(x, bounds.minX), bounds.maxX);
      e.y = Math.min(Math.max(grove.y, bounds.minY), bounds.maxY);
      e.actor.view.position.set(Math.round(e.x), Math.round(e.y));
      e.actor.view.zIndex = Math.round(e.y);
    });
  }
  function syncElders() {
    if (destroyed) return;
    const state = game.getState();
    const want = grove && state.elders?.open ? (state.elders.list || []).slice(0, hcfg.eldersShown) : [];
    const sig = want.map((e) => `${e.id}:${petRole(e)}`).join('|');
    if (sig === elderSig) return;
    elderSig = sig;
    for (const e of elders) { e.shadow.remove(); e.actor.destroy(); }
    elders.length = 0;
    for (const rec of want) {
      const roleId = petRole(rec);
      const actor = createActor(bank, roleId, { anim: 'idle', dir: 'down' });
      const k = roleK(roleId);
      actor.view.scale.set(scale * k);
      world.addChild(actor.view);
      elders.push({
        id: rec.id, roleId, actor, k, x: 0, y: 0, hopMs: -1, sleeping: false, zMs: 0, napMs: 0,
        shadow: polish.addShadow(actor.view, shadowWidth(actor, k)),
      });
    }
    placeElders();
  }
  // Elders stay put: an occasional slow hop, or a nap with floating z's.
  function updateElders(ms, ticker) {
    for (const e of elders) {
      if (e.napMs > 0) {
        if (!e.sleeping) {
          e.sleeping = true;
          e.hopMs = -1;
          e.actor.sprite.y = 0;
          e.actor.view.scale.set(scale * e.k);
          e.actor.play('idle', 'down');
          e.actor.sprite.gotoAndStop(hcfg.restFrame);
        }
        e.napMs -= ms;
        e.zMs += ms;
        if (e.zMs >= hcfg.zIntervalMs) { e.zMs = 0; addZ(e); }
        continue;
      }
      if (e.sleeping) { e.sleeping = false; e.zMs = 0; e.actor.sprite.play(); }
      if (e.hopMs < 0) {
        if (rand.chance(hcfg.elderNapChancePerSec * ms / 1000)) { e.napMs = hcfg.elderNapMs; continue; }
        if (rand.chance(hcfg.elderHopChancePerSec * ms / 1000)) e.hopMs = 0;
      }
      updateHop(e, ms);
      e.actor.update(ticker);
    }
  }

  // ---- project scene: the pets gather, sparkles rise, the new look pops in, (ending) wild monsters visit ----
  let wildSeq = 0;
  const faceDir = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
  const clampToBounds = (x, y) => [Math.min(Math.max(x, bounds.minX), bounds.maxX), Math.min(Math.max(y, bounds.minY), bounds.maxY)];

  function moveGoal(a, ms) {
    const g = a.goal;
    const dx = g.x - a.x;
    const dy = g.y - a.y;
    const dist = Math.hypot(dx, dy);
    const stepPx = g.speed * scale * ms / 1000;
    if (dist <= stepPx) {
      a.x = g.x;
      a.y = g.y;
      a.goal = null;
      a.state = 'pause';
      a.timer = rand.between(wander.minPauseMs, wander.maxPauseMs);
      a.dir = 'up'; // faces the Sanctuary
      a.actor.play('idle', a.dir);
      place(a);
      g.done?.(a);
      return;
    }
    a.dir = faceDir(dx, dy);
    a.x += (dx / dist) * stepPx;
    a.y += (dy / dist) * stepPx;
    a.actor.play('walk', a.dir); // a role without a walk (a mythic) just glides while it idles
    place(a);
  }

  function climax() {
    const n = doneCount(game.getState());
    if (sanctuary.count !== n) swapSanctuary(n, true);
    else { sanctuary.pop = 0; burst(sanctuary); }
    for (const a of activeScene.gathered) if (a.hopMs < 0) a.hopMs = 0;
  }

  function spawnWild(i, n) {
    const wilds = [...agents.values()].filter((x) => x.wild);
    while (wilds.length >= scfg.wildMaxTotal) removeAgent(wilds.shift().id);
    const arch = rand.pick(data.pets.archetypes).id;
    const roleId = `pet.${arch}.hatchling`;
    if (!bank.has(roleId)) return;
    const entry = scfg.wildEntries[wildSeq % scfg.wildEntries.length];
    const a = addAgent(`wild:${wildSeq++}`, roleId, null, true);
    a.x = entry[0] * app.screen.width;
    a.y = entry[1] * app.screen.height;
    place(a);
    const ang = Math.PI * (0.15 + (n > 1 ? 0.7 * i / (n - 1) : 0.35));
    const R = scfg.wildSpotRadiusPx * scale;
    const cx = sanctuary.x;
    const cy = sanctuary.y + scfg.gatherDropPx * scale;
    const [gx, gy] = clampToBounds(cx + Math.cos(ang) * R * 1.3 + rand.between(-4, 4) * scale, cy + Math.sin(ang) * R * 0.6);
    a.goal = {
      x: gx, y: gy, speed: scfg.wildSpeedPxPerSec,
      done: (w) => { w.hopsLeft = scfg.wildHops; w.hopGap = 0; },
    };
    a.state = 'walk';
  }

  function finishScene() {
    const s = activeScene;
    if (!s) return;
    activeScene = null;
    syncSanctuary(false); // a scene cut short still shows the new look
    for (const a of s.gathered) {
      if (!agents.has(a.id)) continue;
      a.goal = null;
      a.remaining = 0;
      startPause(a);
    }
    s.resolve();
  }

  function updateScene(ms) {
    const s = activeScene;
    if (!s) return;
    s.t += ms;
    const f = s.t / s.total;
    if (f >= scfg.showerStartFrac && f <= scfg.showerEndFrac) {
      s.acc += ms / 1000 * scfg.showerPerSec;
      while (s.acc >= 1) { s.acc -= 1; spawnRiser(sanctuary); }
    }
    if (!s.climaxDone && f >= scfg.climaxFrac) { s.climaxDone = true; climax(); }
    while (s.wildLeft > 0 && s.t >= (s.wildTotal - s.wildLeft) * scfg.wildStaggerMs) {
      spawnWild(s.wildTotal - s.wildLeft, s.wildTotal);
      s.wildLeft--;
    }
    if (s.t >= s.total && s.wildLeft === 0) finishScene();
  }

  function playProjectScene(projectId, { ending = false } = {}) {
    if (activeScene) return activeScene.promise;
    if (!running || destroyed || !sanctuary || bounds.maxX <= 0) return Promise.resolve();
    const s = { projectId, ending, t: 0, total: ending ? scfg.endingMs : scfg.sceneMs, acc: 0, climaxDone: false, gathered: [],
      wildTotal: ending ? rand.int(scfg.wildMin, scfg.wildMax) : 0, wildLeft: 0, resolve: null, promise: null };
    s.wildLeft = s.wildTotal;
    s.promise = new Promise((resolve) => { s.resolve = resolve; });
    activeScene = s;
    // Everyone who is free to walk heads for the Sanctuary's front steps.
    const crowd = [...agents.values()].filter((a) => !a.isPlayer && !a.post && !a.sleeping && !a.goal);
    const cx = sanctuary.x;
    const cy = sanctuary.y + scfg.gatherDropPx * scale;
    crowd.forEach((a, i) => {
      const row = Math.floor(i / scfg.gatherPerRow);
      const inRow = Math.min(scfg.gatherPerRow, crowd.length - row * scfg.gatherPerRow);
      const col = i % scfg.gatherPerRow;
      const [gx, gy] = clampToBounds(cx + (col - (inRow - 1) / 2) * scfg.gatherSpacingPx * scale, cy + row * scfg.gatherRowPx * scale);
      a.goal = { x: gx, y: gy, speed: scfg.gatherSpeedPxPerSec };
      a.state = 'walk';
      s.gathered.push(a);
    });
    return s.promise;
  }

  // ---- start-up ----
  addAgent('player', 'player'); // bounds are measured from its sprite
  layout();
  agents.get('player').x = 0; // (re)place it now that bounds exist
  randomSpot(agents.get('player'));
  settle(agents.get('player'));
  syncAgents();
  for (const a of agents.values()) {
    if (a.isPlayer) continue;
    if (a.post) postSpot(a); else { randomSpot(a); settle(a); }
  }
  refreshMarkers();
  const unsubscribe = game.subscribe(syncAgents);
  const unsubEvents = game.onEvents((events) => {
    if (destroyed) return;
    if (events.some((e) => e.type === 'buildingUpgraded')) { syncTiers(running); markerMs = Infinity; }
    if (!running) return; // (subscribers ran first, so a pet that just came home is already drawn)
    for (const e of events) {
      const em = emoteFor(e, data);
      const a = em && agents.get(em.id);
      if (!a || a.wild) continue;
      emotes.show(em.id, em.kind, actorTarget(a, () => agents.get(em.id) !== a), { force: em.force });
      if ((e.type === 'petPat' || e.type === 'petPlayed') && a.hopMs < 0 && !a.sleeping) a.hopMs = 0;
    }
  });
  app.renderer.on('resize', layout);
  // The host may be hidden (zero size) when the scene is built; follow its real size once it shows.
  const sizeWatch = new ResizeObserver(() => { if (host.clientWidth && !destroyed) app.resize(); });
  sizeWatch.observe(host);

  let clock = 0;
  app.ticker.add((ticker) => {
    const ms = ticker.deltaMS;
    clock += ms;
    const state = game.getState();
    syncTiers(true); // also catches test-mode tier changes
    markerMs += ms;
    if (markerMs >= hcfg.markerRefreshMs) { markerMs = 0; refreshMarkers(); }
    for (const a of agents.values()) {
      const asleep = !a.isPlayer && !a.wild && petStatus(state, a.id) === 'resting';
      if (asleep) {
        a.goal = null;
        if (!a.sleeping) {
          a.sleeping = true;
          a.state = 'pause';
          a.hopMs = -1;
          a.actor.sprite.y = 0;
          a.actor.view.scale.set(scale * a.k);
          a.actor.play('idle', a.dir);
          a.actor.sprite.gotoAndStop(hcfg.restFrame);
        }
        a.zMs += ms;
        if (a.zMs >= hcfg.zIntervalMs) { a.zMs = 0; addZ(a); }
        continue;
      }
      if (a.sleeping) {
        a.sleeping = false;
        a.zMs = 0;
        a.actor.sprite.play();
        startPause(a);
      }
      if (a.goal) {
        moveGoal(a, ms); // project scene: walking to a spot beside the Sanctuary
      } else if (a.post) {
        // Working at its station: stays put, hops now and then.
        a.workMs += ms;
        if (a.hopMs < 0 && a.workMs >= hcfg.assistHopEveryMs) { a.workMs = 0; a.hopMs = 0; }
      } else {
        step(a, ms);
      }
      if (a.hopsLeft > 0 && a.hopMs < 0) { // a wild visitor's greeting hops
        a.hopGap -= ms;
        if (a.hopGap <= 0) { a.hopMs = 0; a.hopsLeft--; a.hopGap = scfg.wildHopGapMs; }
      }
      updateHop(a, ms);
      a.actor.update(ticker);
    }
    syncSanctuary(true, ms);
    syncGrove(true);
    syncElders();
    updateElders(ms, ticker);
    updateScene(ms);
    updatePieces(ms, clock);
    updateSparks(ms);
    updateZs(ms);
    emotes.update(ms);
    polish.update(ms);
  });

  return {
    start: () => {
      running = true;
      syncAgents(); syncTiers(false); syncSanctuary(false); syncGrove(false); syncElders(); refreshMarkers();
      app.start();
    },
    stop: () => { finishScene(); running = false; app.stop(); },
    // Plays the restoration scene for a finished project; resolves when it ends (at once if the scene is
    // stopped; a second call while one plays returns the same promise). options.ending = the long finale.
    playProjectScene,
    destroy() {
      if (destroyed) return;
      finishScene();
      destroyed = true;
      running = false;
      unsubscribe();
      unsubEvents();
      emotes.destroy();
      sizeWatch.disconnect();
      app.renderer.off('resize', layout);
      polish.destroy();
      app.destroy(true, { children: true });
      for (const t of owned) t.destroy(true);
    },
  };
}
