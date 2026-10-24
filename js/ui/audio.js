// The audio manager: one music track per scene (crossfaded) and short sound effects for game events.
// Everything is defensive: if the browser cannot play something, the game just stays quiet.
// Browsers (iPhone Safari above all) only allow sound after a tap, so nothing starts before the first one.
// Music plays through an <audio> element (so whole tracks are never decoded into memory);
// effects are decoded once into small buffers. Volumes and fades use gain nodes, because iOS ignores element.volume.

// A tiny silent WAV (8 kHz, 8-bit mono, 8 samples) used to unlock the music elements on the first tap.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==';

export function createAudio(game) {
  const cfg = game.data.audio;
  const bal = game.data.balance.audio;
  const warn = (what, err) => console.warn(`audio: ${what}`, err && err.message ? err.message : err);

  let ctx = null;
  let unlocked = false;
  let scene = null;
  let sfxGain = null;
  let musicGain = null;
  let lastSfx = null;
  let playedCount = 0;

  const settings = () => game.getState().settings || {};
  const musicOn = () => settings().music !== false;
  const soundOn = () => settings().sound !== false;

  // ---------------- sound effects ----------------
  const buffers = new Map(); // sfx id -> Promise of an AudioBuffer (or null if it could not load)
  const lastPlayedAt = new Map();
  let recent = []; // timestamps of recent plays (all sounds), for the per-second cap

  function loadSfx(id) {
    if (buffers.has(id)) return buffers.get(id);
    const file = cfg.sfx[id];
    const p = !file || !ctx ? Promise.resolve(null) : fetch(cfg.sfxDir + file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${file}`))))
      .then((buf) => new Promise((ok, fail) => ctx.decodeAudioData(buf, ok, fail)))
      .catch((err) => { warn(`could not load ${id}`, err); return null; });
    buffers.set(id, p);
    return p;
  }

  function play(id) {
    if (!unlocked || !soundOn() || !ctx || !cfg.sfx[id]) return;
    const now = performance.now();
    if (now - (lastPlayedAt.get(id) ?? -1e9) < bal.sfxMinGapMs) return;
    recent = recent.filter((t) => now - t < 1000);
    if (recent.length >= bal.sfxMaxPerSecond) return;
    // Claim the slot right away so a burst of the same sound cannot slip through while it loads.
    lastPlayedAt.set(id, now);
    recent.push(now);
    loadSfx(id).then((buffer) => {
      if (!buffer || !soundOn()) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(sfxGain);
        src.start();
        lastSfx = id;
        playedCount++;
      } catch (err) { warn('play', err); }
    });
  }

  // Harvest sounds only while the player is watching that zone (not on every tab, all day).
  const watching = (zone) => scene === zone && document.getElementById('screen-world')?.hidden === false;

  function onEvents(events) {
    for (const e of events) {
      const id = e.type === 'harvest' ? (e.worker === 'player' && watching(e.zone) ? cfg.harvestBySkill[e.skill] : null) : cfg.events[e.type];
      if (id) play(id);
    }
  }

  // ---------------- music ----------------
  const canOgg = (() => {
    try { return document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"') !== ''; } catch { return false; }
  })();
  let slots = null; // two reusable players so tracks can crossfade
  let active = null; // the slot currently audible
  let musicToken = 0;

  function makeSlots() {
    slots = [0, 1].map(() => {
      const el = document.createElement('audio');
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(musicGain);
      return { el, gain, file: null, url: null };
    });
  }

  function ramp(slot, to, ms) {
    const g = slot.gain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + ms / 1000);
  }

  function release(slot) {
    slot.file = null;
    try { slot.el.pause(); } catch { /* ignore */ }
    if (slot.url) { URL.revokeObjectURL(slot.url); slot.url = null; }
    slot.el.removeAttribute('src');
  }

  function fadeOut(slot) {
    ramp(slot, 0, bal.musicFadeMs);
    slot.file = null; // no longer wanted; it is released once the fade is done
    setTimeout(() => { if (slot !== active && slot.file === null) release(slot); }, bal.musicFadeMs + 100);
  }

  async function applyMusic() {
    if (!unlocked || !canOgg || !slots) return;
    if (document.hidden) {
      if (active) { try { active.el.pause(); } catch { /* ignore */ } }
      return;
    }
    const file = musicOn() ? (cfg.music[scene] || null) : null;
    if (!file) {
      musicToken++;
      if (active) { const old = active; active = null; fadeOut(old); }
      return;
    }
    if (active && active.file === file) {
      if (active.el.paused) {
        try { await active.el.play(); ramp(active, 1, bal.musicFadeMs); } catch (err) { warn('resume music', err); }
      }
      return;
    }
    const token = ++musicToken;
    try {
      const res = await fetch(cfg.musicDir + file);
      if (!res.ok) throw new Error(`${res.status} ${file}`);
      const url = URL.createObjectURL(await res.blob());
      if (token !== musicToken) { URL.revokeObjectURL(url); return; }
      const slot = slots.find((s) => s !== active) || slots[0];
      release(slot);
      slot.el.src = url;
      slot.url = url;
      slot.file = file;
      slot.gain.gain.cancelScheduledValues(ctx.currentTime);
      slot.gain.gain.setValueAtTime(0, ctx.currentTime);
      await slot.el.play();
      if (token !== musicToken) { release(slot); return; }
      const old = active;
      active = slot;
      ramp(slot, 1, bal.musicFadeMs);
      if (old) fadeOut(old);
    } catch (err) {
      warn('music', err); // Ogg not playable, offline and never heard, etc.: stay silent
    }
  }

  // ---------------- unlock (first tap) ----------------
  const unlockEvents = ['pointerdown', 'touchend', 'keydown'];
  function removeUnlockListeners() {
    for (const t of unlockEvents) document.removeEventListener(t, unlock, true);
  }
  function unlock() {
    if (unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { removeUnlockListeners(); return; }
      ctx = new AC();
      if (ctx.resume) ctx.resume();
      sfxGain = ctx.createGain();
      sfxGain.gain.value = bal.sfxVolume;
      sfxGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = bal.musicVolume;
      musicGain.connect(ctx.destination);
      if (canOgg) {
        makeSlots();
        // iPhone Safari lets an <audio> element play later from code only if it first played inside a tap.
        for (const s of slots) {
          s.el.src = SILENT_WAV;
          s.el.play().then(() => { if (!s.file) s.el.pause(); }).catch(() => {});
        }
      }
      unlocked = true;
      removeUnlockListeners();
      for (const id of Object.keys(cfg.sfx)) loadSfx(id);
      applyMusic();
    } catch (err) {
      warn('unlock', err);
    }
  }
  for (const t of unlockEvents) document.addEventListener(t, unlock, true);

  // ---------------- wiring ----------------
  game.onEvents(onEvents);

  let lastMusic = musicOn();
  game.subscribe(() => {
    if (musicOn() !== lastMusic) { lastMusic = musicOn(); applyMusic(); }
  });

  document.addEventListener('visibilitychange', () => {
    if (!unlocked) return;
    if (!document.hidden && ctx.resume) ctx.resume();
    applyMusic();
  });

  // A very quiet tap on button presses (no hover sounds).
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('button')) play(cfg.uiTap);
  }, true);

  return {
    setScene(name) {
      if (!name || name === scene) return;
      if (!cfg.music[name]) return; // a scene without its own track keeps the current one
      scene = name;
      applyMusic();
    },
    getScene: () => scene,
    debug() {
      return {
        unlocked,
        scene,
        musicOn: musicOn(),
        soundOn: soundOn(),
        lastSfx,
        played: playedCount,
        ctxState: ctx ? ctx.state : null,
        musicFile: active ? active.file : null,
        musicPaused: active ? active.el.paused : null,
        musicTime: active ? active.el.currentTime : null,
        canOgg,
      };
    },
  };
}
