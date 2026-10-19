// Polish layer v1: soft shadows, day/night tint from the real clock, occasional rain, and ambient
// particles (leaves and pollen by day, fireflies at night). Used by the Home and zone scenes.
// Render-only: it reads Date.now() and Math.random (allowed in render code) and never touches game
// state. It rides on the owning scene's ticker (the scene calls update(ms)), so it pauses with it.
// Every number comes from data.balance.render.polish.
//
// Usage (the scene adds the containers in this order):
//   const polish = createPolish(app, { cfg: balance.render.polish, bank });
//   app.stage.addChild(ground, polish.shadows, world, polish.air, polish.tint, fx, polish.top);
//   polish.resize(w, h, scale);  // on layout
//   polish.update(ms);           // from the ticker
//   const s = polish.addShadow(view, widthInSpriteUnits); s.groundY = y (optional); s.remove();
import { Container, Sprite, Texture } from '../../lib/pixi.mjs';

const colorOf = (v) => Number(v); // balance.json stores colors as "0xrrggbb" strings
const TAU = Math.PI * 2;

// ---- test override (module level; every scene reads it each frame) ----
const override = { hour: null, rain: null };
let overrideRev = 0;
// setPolishOverride({ hour: 2 }) forces the clock hour (0-24, decimals ok); { rain: true } forces
// rain on or off. Pass null for a field to give control back to the real clock. Missing fields stay.
export function setPolishOverride(next = {}) {
  if ('hour' in next) override.hour = next.hour;
  if ('rain' in next) override.rain = next.rain;
  overrideRev++;
}
export function getPolishOverride() { return { ...override }; }

// ---- helpers ----
function canvasTexture(w, h, draw, smooth = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = Texture.from(c);
  tex.source.scaleMode = smooth ? 'linear' : 'nearest';
  return tex;
}
const css = (n) => `#${n.toString(16).padStart(6, '0')}`;
const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (a, b, t) => {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
};
const mulColor = (a, b) => {
  const r = Math.round(((a >> 16) & 255) * ((b >> 16) & 255) / 255);
  const g = Math.round(((a >> 8) & 255) * ((b >> 8) & 255) / 255);
  const bl = Math.round((a & 255) * (b & 255) / 255);
  return (r << 16) | (g << 8) | bl;
};
// Cheap deterministic hash of an integer -> 0..1 (so every scene agrees whether this hour rains).
function hash01(n) {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// Frames of a pack effect strip (fx.leaf...), or null if it isn't in the atlas.
function fxFrames(bank, role) {
  if (!bank) return null;
  const out = [];
  for (let i = 0; i < 12; i++) {
    const t = bank.texture(role, 'idle', i);
    if (!t) break;
    out.push(t);
  }
  return out.length ? out : null;
}

export function createPolish(app, { cfg, bank = null } = {}) {
  const shadows = new Container();
  const air = new Container();
  const tint = new Container();
  const top = new Container();
  const owned = []; // textures made here, destroyed with the layer

  const own = (t) => { owned.push(t); return t; };

  // ---- shadows ----
  const scfg = cfg.shadow;
  const shadowTex = own(canvasTexture(64, 24, (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.scale(1, h / w);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    grad.addColorStop(0, `rgba(20,16,36,${scfg.alpha})`);
    grad.addColorStop(0.65, `rgba(20,16,36,${scfg.alpha * 0.7})`);
    grad.addColorStop(1, 'rgba(20,16,36,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, w / 2, 0, TAU);
    g.fill();
  }, true));
  const shadowList = [];
  let scale = 1;
  let sw = 0;
  let sh = 0;

  function addShadow(view, widthUnits, dyUnits = scfg.yOffsetPx) {
    const sprite = new Sprite(shadowTex);
    sprite.anchor.set(0.5);
    shadows.addChild(sprite);
    const h = { view, sprite, w: widthUnits, dy: dyUnits, groundY: null, dead: false,
      remove() { if (h.dead) return; h.dead = true; sprite.destroy(); } };
    shadowList.push(h);
    placeShadow(h);
    return h;
  }
  function placeShadow(h) {
    const v = h.view;
    if (v.destroyed) { h.remove(); return; }
    const s = h.w * scale / shadowTex.width;
    h.sprite.scale.set(s);
    h.sprite.position.set(Math.round(v.x), Math.round((h.groundY ?? v.y) + h.dy * scale));
    h.sprite.visible = v.visible && !!v.parent;
  }

  // ---- day / night tint (a full-screen multiply sprite: one quad, no filter) ----
  const keys = cfg.tint.map((k) => ({ hour: k.hour, color: colorOf(k.color), night: k.night }));
  const overlay = new Sprite(Texture.WHITE);
  overlay.blendMode = 'multiply';
  tint.addChild(overlay);
  let tintMs = Infinity; // forces a first update
  let seenRev = -1;
  let night = 0;
  let baseColor = 0xffffff;
  let rainTarget = 0;
  let rainK = 0;
  const rainTint = colorOf(cfg.rain.tint);

  function hourNow() {
    if (override.hour != null) return ((override.hour % 24) + 24) % 24;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
  function sampleClock() {
    const h = hourNow();
    let i = 0;
    while (i < keys.length - 2 && h >= keys[i + 1].hour) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = Math.min(1, Math.max(0, (h - a.hour) / (b.hour - a.hour || 1)));
    baseColor = lerpColor(a.color, b.color, t);
    night = lerp(a.night, b.night, t);
    if (override.rain != null) rainTarget = override.rain ? 1 : 0;
    else rainTarget = hash01(Math.floor(Date.now() / cfg.rain.hourMs)) < cfg.rain.chancePerHour ? 1 : 0;
  }
  function applyTint() {
    const rainy = lerpColor(0xffffff, rainTint, rainK);
    const c = mulColor(baseColor, rainy);
    if (overlay.tint !== c) overlay.tint = c;
    overlay.visible = c !== 0xffffff;
  }

  // ---- particles ----
  const lcfg = cfg.leaves;
  const mcfg = cfg.motes;
  const fcfg = cfg.fireflies;
  const rcfg = cfg.rain;

  const leafFrames = fxFrames(bank, 'fx.leaf');
  const leafTex = leafFrames || [own(canvasTexture(5, 3, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(1, 0, 3, 1);
    g.fillRect(0, 1, 5, 1);
    g.fillRect(1, 2, 3, 1);
  }))];
  const moteTex = own(canvasTexture(2, 2, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 2, 2); }));
  const rainTex = own(canvasTexture(1, rcfg.lengthPx, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }));
  const glowTex = own(canvasTexture(32, 32, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  }, true));

  const leaves = [];
  const motes = [];
  const flies = [];
  const drops = [];
  const rnd = Math.random;

  for (let i = 0; i < lcfg.count; i++) {
    const s = new Sprite(leafTex[i % leafTex.length]);
    s.anchor.set(0.5);
    s.tint = colorOf(lcfg.colors[i % lcfg.colors.length]);
    s.alpha = lcfg.alpha;
    air.addChild(s);
    leaves.push({ s, x: rnd(), y: rnd(), ph: rnd() * TAU, spin: rnd() * TAU });
  }
  for (let i = 0; i < mcfg.count; i++) {
    const s = new Sprite(moteTex);
    s.anchor.set(0.5);
    s.tint = colorOf(mcfg.color);
    air.addChild(s);
    motes.push({ s, x: rnd(), y: rnd(), ph: rnd() * TAU });
  }
  for (let i = 0; i < rcfg.count; i++) {
    const s = new Sprite(rainTex);
    s.anchor.set(0.5, 0);
    s.tint = colorOf(rcfg.color);
    air.addChild(s);
    drops.push({ s, x: rnd(), y: rnd(), v: 0.8 + rnd() * 0.4 });
  }
  for (let i = 0; i < fcfg.count; i++) {
    const s = new Sprite(glowTex);
    s.anchor.set(0.5);
    s.tint = colorOf(fcfg.color);
    s.blendMode = 'add';
    top.addChild(s);
    flies.push({ s, x: rnd(), y: rnd(), ph: rnd() * TAU, ph2: rnd() * TAU });
  }

  let clock = 0; // seconds, drives sways

  function updateParticles(dt) {
    const day = (1 - night) * (1 - rainK);
    const px = scale;
    // leaves: fall and drift, wrap at the edges (positions kept as screen px after first use)
    const showLeaves = day > 0.02;
    for (const l of leaves) {
      l.s.visible = showLeaves;
      if (!showLeaves) continue;
      if (l.x <= 1 && l.y <= 1) { l.x *= sw; l.y *= sh; } // first use: fraction -> pixels
      l.x += lcfg.driftPxPerSec * px * dt;
      l.y += lcfg.fallPxPerSec * px * dt;
      if (l.x > sw + 8) l.x = -8;
      if (l.y > sh + 8) { l.y = -8; l.x = rnd() * sw; }
      l.spin += lcfg.spinPerSec * dt;
      l.s.position.set(Math.round(l.x + Math.sin(clock * lcfg.swayHz * TAU + l.ph) * lcfg.swayPx * px), Math.round(l.y));
      l.s.rotation = Math.sin(l.spin) * 0.9;
      l.s.scale.set(px);
      l.s.alpha = lcfg.alpha * Math.min(1, day * 2);
    }
    for (const m of motes) {
      m.s.visible = showLeaves;
      if (!showLeaves) continue;
      if (m.x <= 1 && m.y <= 1) { m.x *= sw; m.y *= sh; }
      m.x += mcfg.driftPxPerSec * px * dt;
      m.y -= mcfg.driftPxPerSec * 0.5 * px * dt;
      if (m.x > sw + 4) m.x = -4;
      if (m.y < -4) m.y = sh + 4;
      m.s.position.set(Math.round(m.x + Math.sin(clock * 0.7 + m.ph) * mcfg.swayPx * px), Math.round(m.y));
      m.s.scale.set(px);
      m.s.alpha = mcfg.alpha * (0.5 + 0.5 * Math.sin(clock * mcfg.twinkleHz * TAU + m.ph)) * Math.min(1, day * 2);
    }
    // fireflies: glow above the night tint
    const glow = night * (1 - rainK * 0.7);
    const showFlies = glow > 0.02;
    for (const f of flies) {
      f.s.visible = showFlies;
      if (!showFlies) continue;
      if (f.x <= 1 && f.y <= 1) { f.x *= sw; f.y *= sh; }
      const wx = Math.sin(clock * fcfg.wanderHz * TAU + f.ph) * fcfg.wanderPx * px;
      const wy = Math.cos(clock * fcfg.wanderHz * 1.3 * TAU + f.ph2) * fcfg.wanderPx * 0.6 * px;
      f.s.position.set(Math.round(f.x + wx), Math.round(f.y + wy));
      const blink = Math.max(0, Math.sin(clock * fcfg.blinkHz * TAU + f.ph2));
      f.s.alpha = fcfg.alpha * glow * blink * blink;
      f.s.scale.set(fcfg.sizePx * px / glowTex.width);
    }
    // rain
    const showRain = rainK > 0.02;
    for (const d of drops) {
      d.s.visible = showRain;
      if (!showRain) continue;
      if (d.x <= 1 && d.y <= 1) { d.x *= sw; d.y *= sh; }
      const v = rcfg.speedPxPerSec * px * d.v * dt;
      d.y += v;
      d.x -= v * rcfg.slant;
      if (d.y > sh) { d.y = -rcfg.lengthPx * px; d.x = rnd() * (sw + sh * rcfg.slant); }
      if (d.x < 0) d.x += sw;
      d.s.position.set(Math.round(d.x), Math.round(d.y));
      d.s.scale.set(px);
      d.s.rotation = Math.atan(rcfg.slant);
      d.s.alpha = rcfg.alpha * rainK;
    }
  }

  return {
    shadows, air, tint, top,
    addShadow,
    resize(w, h, pixelScale) {
      sw = w;
      sh = h;
      scale = pixelScale;
      overlay.width = w;
      overlay.height = h;
      for (const s of shadowList) if (!s.dead) placeShadow(s);
    },
    update(ms) {
      const dt = Math.min(ms, 100) / 1000;
      clock += dt;
      tintMs += ms;
      if (tintMs >= cfg.tintUpdateMs || seenRev !== overrideRev) {
        tintMs = 0;
        seenRev = overrideRev;
        sampleClock();
      }
      const step = ms / cfg.rain.fadeMs;
      rainK = rainK < rainTarget ? Math.min(rainTarget, rainK + step) : Math.max(rainTarget, rainK - step);
      applyTint();
      updateParticles(dt);
      for (let i = shadowList.length - 1; i >= 0; i--) {
        const h = shadowList[i];
        if (h.dead) { shadowList.splice(i, 1); continue; }
        placeShadow(h);
      }
    },
    // Snaps to the clock now (used by tests after changing the override).
    refresh() { sampleClock(); rainK = rainTarget; applyTint(); },
    destroy() {
      for (const t of owned) t.destroy(true);
      shadowList.length = 0;
    },
  };
}
