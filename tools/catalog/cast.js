// Casting mode for the art catalog: choose which pack sprite plays each game role.
// Reads and writes data/sprites.json (saving goes through the dev server, /__dev/cast).
// Dev-only; nothing here ships with the game.

const DATA_URL = '../../data/sprites.json';
const SAVE_URL = '/__dev/cast';
const ROW_BOX = 80;   // preview box size in the role list (pixels)
const OV_BOX = 256;   // preview box size in the big overlay (pixels)
const ROLE_FIELD_ORDER = ['group', 'label', 'layout', 'src', 'frameWidth', 'frameHeight', 'face'];

export async function initCast({ files, urlFor, $, refilter }) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const wide = window.matchMedia('(min-width: 900px)');
  let data = null;          // the working copy of sprites.json
  let snap = '';            // JSON of the last saved/loaded state, to spot unsaved changes
  let activeRole = null;    // role id being picked, or null
  let chipOn = false;       // quick-filter chip state
  let ovEntry = null;       // file currently shown in the overlay
  let ovPlan = null;        // casting plan for that file

  const panel = $('cast-panel');
  const banner = $('pick-banner');

  // ---------- small helpers ----------
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const intScale = (w, h, box) => Math.max(1, Math.floor(Math.min(box / w, box / h)));
  const isDirty = () => !!data && JSON.stringify(data) !== snap;

  // ---------- animated previews ----------
  const imgCache = new Map();
  function loadImg(path) {
    if (!imgCache.has(path)) {
      imgCache.set(path, new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('missing ' + path));
        i.src = urlFor(path);
      }));
    }
    return imgCache.get(path);
  }

  // Frame size a role plays with: its own override (boss strips) or the layout's.
  function frameSize(layout, role) {
    return [role.frameWidth ?? layout.frameWidth, role.frameHeight ?? layout.frameHeight];
  }
  // Which animation the preview plays: "walk" if the layout has it, else the first.
  function previewAnimName(layout) {
    return layout.anims.walk ? 'walk' : Object.keys(layout.anims)[0];
  }
  const sheetFileFor = (src, anim) => (anim.file ? dirOf(src) + '/' + anim.file : src);

  // Number of frames in an anim; 0 in the data means "as many as fit".
  function frameCount(anim, sheetW, sheetH, fw, fh) {
    if (anim.frames > 0) return anim.frames;
    if (anim.dirs || anim.axis === 'col') return Math.max(1, Math.floor(sheetH / fh) - anim.start[1]);
    return Math.max(1, Math.floor(sheetW / fw) - anim.start[0]);
  }
  // Which cell (column,row) of the sheet holds frame i facing direction d.
  function cellFor(anim, d, i) {
    const [c0, r0] = anim.start;
    if (anim.dirs) return [c0 + d, r0 + i];          // column = direction, rows = frames
    if (anim.axis === 'col') return [c0, r0 + i];
    return [c0 + i, r0];
  }

  // The running previews; a single animation loop draws all that are visible.
  const running = new Set();
  function tick(now) {
    for (const a of running) {
      if (!a.canvas.isConnected) { running.delete(a); continue; }
      if (!a.canvas.offsetParent) continue; // hidden: skip drawing
      const f = Math.floor((now / 1000) * a.fps) % a.frames;
      if (f === a.last) continue;
      a.last = f;
      const [c, r] = cellFor(a.anim, 0, f); // always facing down
      a.ctx.clearRect(0, 0, a.canvas.width, a.canvas.height);
      a.ctx.imageSmoothingEnabled = false;
      a.ctx.drawImage(a.img, c * a.fw, r * a.fh, a.fw, a.fh, 0, 0, a.fw * a.scale, a.fh * a.scale);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Start animating `canvas` as `spec` ({layout, src, frameWidth?, frameHeight?}) would play.
  async function startPreview(canvas, spec, box) {
    for (const a of running) if (a.canvas === canvas) running.delete(a);
    canvas.title = '';
    const layout = data.layouts[spec.layout];
    if (!layout || !spec.src) return;
    const anim = layout.anims[previewAnimName(layout)];
    const [fw, fh] = frameSize(layout, spec);
    try {
      const img = await loadImg(sheetFileFor(spec.src, anim));
      const scale = intScale(fw, fh, box);
      canvas.width = fw * scale;
      canvas.height = fh * scale;
      running.add({
        canvas, ctx: canvas.getContext('2d'), img, anim, fw, fh, scale,
        frames: frameCount(anim, img.naturalWidth, img.naturalHeight, fw, fh),
        fps: anim.fps || 6, last: -1,
      });
    } catch {
      canvas.width = canvas.height = 32;
      canvas.title = 'Picture not found';
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, 32, 32);
      g.fillStyle = '#c66'; g.font = '24px sans-serif'; g.fillText('?', 10, 24);
    }
  }

  // ---------- detecting a layout for a picked file ----------
  // Boss strips: take the frame size from IdlePreview.gif when it fits the strip, else assume square frames.
  function guessStrip(e) {
    const gif = byPath.get(dirOf(e.path) + '/IdlePreview.gif');
    if (gif && gif.height === e.height && e.width % gif.width === 0) return [gif.width, gif.height];
    if (e.width % e.height === 0) return [e.height, e.height];
    if (gif && gif.height === e.height) return [gif.width, gif.height];
    return [e.height, e.height];
  }

  // Returns {layout, error?} for a file. `layout` is a guess (may be null).
  function detect(e) {
    const parts = e.path.split('/');
    const name = parts[parts.length - 1];
    if (!/\.png$/i.test(name)) return { layout: null, fatal: true, error: 'Only PNG pictures can be cast (this is not a PNG).' };
    if (name === 'Faceset.png') return { layout: null, fatal: true, error: 'This is a face picture. Faces are picked automatically; choose the sprite sheet in the same folder instead.' };
    if (parts[0] === 'Actor' && parts[1] === 'CharacterAnimated') {
      if (parts.length === 4 && name === 'SpriteSheet.png') return { layout: 'hero' };
      return { layout: null, error: 'This folder is a fully animated character. Pick the SpriteSheet.png in the character\'s folder (not Preview or Separate files).' };
    }
    if (parts[0] === 'Actor' && parts[1] === 'Boss') {
      if (e.width > e.height) return { layout: 'strip' };
      return { layout: null, error: 'This picture isn\'t a wide row of frames. For a boss, pick Idle.png.' };
    }
    if (e.width === 64 && e.height === 64) return { layout: 'monster' };
    if (e.width === 64 && e.height === 112) return { layout: 'character' };
    return { layout: null, error: `Not recognised (${e.width}x${e.height}). Pet sheets are 64x64, simple characters are 64x112, ` +
      'players are a SpriteSheet in CharacterAnimated, bosses are the Idle strip in Boss. Use the layout menu to force a layout.' };
  }

  // Check that every animation of `layoutName` fits in the picked file (and its sibling files).
  function checkFit(e, layoutName, fw, fh) {
    const layout = data.layouts[layoutName];
    for (const [name, a] of Object.entries(layout.anims)) {
      const p = sheetFileFor(e.path, a);
      const f = byPath.get(p);
      if (!f) return `The "${name}" animation needs ${baseOf(p)} next to this picture, but it isn't in the pack. Pick a SpriteSheet from a full character folder.`;
      const need = a.frames > 0 ? a.frames : 1;
      const cols = a.dirs ? a.start[0] + data.directions.length : a.axis === 'col' ? a.start[0] + 1 : a.start[0] + need;
      const rows = a.dirs || a.axis === 'col' ? a.start[1] + need : a.start[1] + 1;
      if (Math.floor(f.width / fw) < cols || Math.floor(f.height / fh) < rows) {
        const hint = a.dirs ? " It isn't a 4-direction sheet; pick a SpriteSheet." : '';
        return `This picture isn't the right shape for "${layout.label}": ${baseOf(p)} is ${f.width}x${f.height}, ` +
          `but the "${name}" animation needs at least ${cols * fw}x${rows * fh}.${hint}`;
      }
    }
    if (layoutName === 'strip' && e.width % fw !== 0) {
      return `Warning only: the strip is ${e.width} wide, which isn't a whole number of ${fw}-wide frames. Check the frame size.`;
    }
    return null;
  }

  // Work out everything needed to cast file `e`. `override` = layout name or ''; fwIn/fhIn = manual strip sizes.
  function makePlan(e, override, fwIn, fhIn) {
    const det = detect(e);
    if (det.fatal) return { error: det.error };
    const layoutName = override || det.layout;
    if (!layoutName) return { error: det.error };
    const layout = data.layouts[layoutName];
    let [fw, fh] = [layout.frameWidth, layout.frameHeight];
    if (layoutName === 'strip') {
      [fw, fh] = guessStrip(e);
      if (fwIn > 0) fw = fwIn;
      if (fhIn > 0) fh = fhIn;
    }
    const msg = checkFit(e, layoutName, fw, fh);
    const warnOnly = msg && msg.startsWith('Warning only');
    // Fully animated characters keep their face in the matching simple-character folder.
    const faceDirs = [dirOf(e.path), dirOf(e.path).replace('Actor/CharacterAnimated/', 'Actor/Character/')];
    const facePath = faceDirs.map((d) => d + '/Faceset.png').find((p) => byPath.has(p)) || null;
    return {
      layout: layoutName, fw, fh, src: e.path, face: facePath,
      error: msg && !warnOnly ? msg : null, warn: warnOnly ? msg : null,
    };
  }

  // Apply a plan to a role in the working data. Only role fields change; other keys are kept.
  function castRole(roleId, plan) {
    const old = data.roles[roleId];
    const next = {};
    const values = { group: old.group, label: old.label, layout: plan.layout, src: plan.src, face: plan.face };
    if (plan.layout === 'strip') { values.frameWidth = plan.fw; values.frameHeight = plan.fh; }
    for (const k of ROLE_FIELD_ORDER) if (k in values) next[k] = values[k];
    for (const k of Object.keys(old)) if (!(k in next) && !ROLE_FIELD_ORDER.includes(k)) next[k] = old[k];
    data.roles[roleId] = next;
  }

  // ---------- the casting panel ----------
  function renderPanel() {
    if (!data) return;
    const body = $('cast-list');
    body.innerHTML = '';
    for (const g of data.groups) {
      const sec = el('section', 'cast-group');
      sec.appendChild(el('h3', '', g.label));
      for (const [id, role] of Object.entries(data.roles)) {
        if (role.group !== g.id) continue;
        const row = el('div', 'cast-row' + (id === activeRole ? ' active' : ''));
        const box = el('div', 'cast-box');
        const cv = document.createElement('canvas');
        box.appendChild(cv);
        const info = el('div', 'cast-info');
        info.appendChild(el('div', 'cast-label', role.label));
        const picked = el('div', role.src ? 'cast-file' : 'cast-file none', role.src ? baseOf(role.src) : 'not cast');
        if (role.src) picked.title = role.src;
        info.appendChild(picked);
        if (role.src) info.appendChild(el('div', 'cast-dir', dirOf(role.src).replace(/^Actor\//, '')));
        const btn = el('button', '', id === activeRole ? 'Picking...' : 'Choose');
        btn.type = 'button';
        btn.addEventListener('click', () => (id === activeRole ? stopPicking() : startPicking(id)));
        row.append(box, info, btn);
        sec.appendChild(row);
        if (role.src) startPreview(cv, role, ROW_BOX);
        else box.classList.add('empty');
      }
      body.appendChild(sec);
    }
    updateStatus();
  }

  function updateStatus() {
    const dirty = isDirty();
    $('cast-state').textContent = dirty ? 'Unsaved changes' : 'No unsaved changes';
    $('cast-state').classList.toggle('dirty', dirty);
    $('cast-badge').hidden = !dirty;
  }

  function openPanel(open) {
    panel.hidden = !open;
    document.body.classList.toggle('cast-open', open);
    $('cast-toggle').setAttribute('aria-expanded', String(open));
    if (open) renderPanel(); // restart previews that were skipped while hidden
    placeBars();
  }
  // Keep the panel and banner just below the sticky toolbar.
  function placeBars() {
    const h = document.querySelector('.toolbar').offsetHeight;
    document.documentElement.style.setProperty('--tb', h + 'px');
  }
  window.addEventListener('resize', placeBars);

  // ---------- picking a role ----------
  const CHIPS = { pets: ['Monsters', 'Monster'], mythics: ['Bosses', 'Boss'], player: ['Characters', 'Character'] };

  function startPicking(id) {
    activeRole = id;
    chipOn = false;
    if (!wide.matches) openPanel(false); // on narrow screens the drawer would hide the sprites
    renderBanner();
    renderPanel();
    refilter();
  }
  function stopPicking() {
    activeRole = null;
    chipOn = false;
    renderBanner();
    renderPanel();
    refilter();
  }
  function renderBanner() {
    banner.innerHTML = '';
    banner.hidden = !activeRole;
    if (!activeRole) return;
    const role = data.roles[activeRole];
    banner.appendChild(el('span', 'banner-text', `Picking: ${role.label} — tap a sprite`));
    const chip = CHIPS[role.group];
    if (chip) {
      const c = el('button', 'chip' + (chipOn ? ' on' : ''), chip[0]);
      c.type = 'button';
      c.setAttribute('aria-pressed', String(chipOn));
      c.addEventListener('click', () => { chipOn = !chipOn; renderBanner(); refilter(); });
      banner.appendChild(c);
    }
    const cancel = el('button', '', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', stopPicking);
    banner.appendChild(cancel);
    placeBars();
  }
  // Extra file filter for the catalog grid (null = none).
  function filter() {
    if (!activeRole || !chipOn) return null;
    const chip = CHIPS[data.roles[activeRole].group];
    if (!chip) return null;
    if (chip[1] === 'Character') return (e) => e.category === 'Actor' && (e.subcategory === 'Character' || e.subcategory === 'CharacterAnimated');
    return (e) => e.category === 'Actor' && e.subcategory === chip[1];
  }

  // ---------- the overlay's casting section ----------
  function refreshOverlay() {
    if (!ovEntry) return;
    const plan = makePlan(ovEntry, $('ov-layout').value, +$('ov-fw').value, +$('ov-fh').value);
    ovPlan = plan;
    const strip = (plan.layout || $('ov-layout').value) === 'strip';
    $('ov-frame').hidden = !strip;
    if (strip && plan.fw && document.activeElement !== $('ov-fw')) { $('ov-fw').value = plan.fw; $('ov-fh').value = plan.fh; }
    const msg = $('ov-cast-msg');
    msg.textContent = plan.error || plan.warn || (plan.layout
      ? `Will play as: ${data.layouts[plan.layout].label}${plan.face ? '' : ' (no face picture found)'}` : '');
    msg.className = 'cast-msg' + (plan.error ? ' bad' : plan.warn ? ' warn' : '');
    const cv = $('ov-anim');
    $('ov-anim-wrap').hidden = !!plan.error;
    if (!plan.error) startPreview(cv, plan, OV_BOX);
    const targetId = activeRole || $('ov-role').value;
    $('ov-cast-btn').disabled = !!plan.error || !targetId;
    $('ov-cast-btn').textContent = activeRole ? `Cast as ${data.roles[activeRole].label}` : 'Cast';
    $('ov-role').hidden = !!activeRole;
    $('ov-role-label').hidden = !!activeRole;
  }

  function onOpen(e) {
    if (!data) return;
    ovEntry = e;
    $('ov-layout').value = '';
    $('ov-fw').value = '';
    $('ov-fh').value = '';
    refreshOverlay();
  }

  $('ov-layout').addEventListener('change', () => { $('ov-fw').value = ''; $('ov-fh').value = ''; refreshOverlay(); });
  $('ov-fw').addEventListener('input', refreshOverlay);
  $('ov-fh').addEventListener('input', refreshOverlay);
  $('ov-role').addEventListener('change', refreshOverlay);
  $('ov-cast-btn').addEventListener('click', () => {
    const roleId = activeRole || $('ov-role').value;
    if (!ovPlan || ovPlan.error || !roleId) return;
    castRole(roleId, ovPlan);
    const wasPicking = !!activeRole;
    activeRole = null;
    chipOn = false;
    $('overlay').hidden = true;
    renderBanner();
    openPanel(true);
    refilter();
    setSaveMessage(`Cast "${data.roles[roleId].label}" as ${baseOf(ovPlan.src)}. Remember to save.`, '');
    if (!wasPicking) $('ov-role').value = roleId;
  });

  // ---------- saving ----------
  function setSaveMessage(text, kind, log) {
    const m = $('cast-msg');
    m.textContent = text;
    m.className = 'cast-msg' + (kind ? ' ' + kind : '');
    m.hidden = !text;
    $('cast-log').textContent = log || '';
    $('cast-log-wrap').hidden = !log;
  }
  const jsonText = () => JSON.stringify(data, null, 2) + '\n';

  async function save() {
    // Refuse when a cast file isn't in the pack; just warn about uncast roles.
    const bad = [];
    const uncast = [];
    for (const role of Object.values(data.roles)) {
      if (!role.src) { uncast.push(role.label); continue; }
      for (const p of [role.src, role.face]) if (p && !byPath.has(p)) bad.push(`${role.label}: ${p}`);
    }
    if (bad.length) {
      setSaveMessage('Not saved: some picked pictures are not in the art pack.', 'bad', bad.join('\n'));
      return;
    }
    const note = uncast.length ? `Note: ${uncast.length} role(s) are still not cast: ${uncast.join(', ')}.\n` : '';
    const btn = $('cast-save');
    btn.disabled = true;
    setSaveMessage('Saving and building the atlas...', '');
    const text = jsonText();
    try {
      const r = await fetch(SAVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
      if (r.status === 404) throw new Error('no endpoint');
      let res = null;
      try { res = await r.json(); } catch { /* not JSON */ }
      const log = note + (res && res.log ? res.log : '');
      if (r.ok) {
        snap = JSON.stringify(data); // the file was written, even if the atlas step failed
        if (res && res.ok) setSaveMessage('Saved, and the atlas was rebuilt. Reload the game to see the new sprites.', 'good', log);
        else setSaveMessage('Your casting is saved, but building the atlas failed. The log below says why.', 'warn', log);
      } else {
        setSaveMessage('Not saved: the server refused it (see the log).', 'bad', note + (res && res.log ? res.log : 'HTTP ' + r.status));
      }
    } catch {
      setSaveMessage('Saving needs the dev server: run tools/serve.ps1 (and open this page from it). You can copy the casting JSON instead.', 'bad', note);
      $('cast-copy').hidden = false;
    } finally {
      btn.disabled = false;
      updateStatus();
    }
  }

  async function copyJson() {
    const ta = $('cast-json');
    try {
      await navigator.clipboard.writeText(jsonText());
      setSaveMessage('Casting JSON copied. Paste it over data/sprites.json.', 'good');
    } catch {
      ta.hidden = false;
      ta.value = jsonText();
      ta.select();
      setSaveMessage('Could not copy automatically: the text is selected below, press Ctrl+C.', 'warn');
    }
  }

  async function loadData() {
    const r = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
    snap = JSON.stringify(data);
  }

  async function revert() {
    if (isDirty() && !confirm('Throw away your unsaved casting changes and reload from the saved file?')) return;
    try {
      await loadData();
      activeRole = null;
      renderBanner();
      renderPanel();
      refilter();
      setSaveMessage('Reloaded from the saved file.', '');
    } catch {
      setSaveMessage('Could not reload data/sprites.json.', 'bad');
    }
  }

  // ---------- wire up ----------
  try {
    await loadData();
  } catch {
    $('cast-toggle').addEventListener('click', () => alert('Could not load data/sprites.json, so casting is unavailable.'));
    return { onOpen() {}, filter: () => null };
  }

  // Fill the layout and role menus in the overlay.
  const lsel = $('ov-layout');
  for (const [name, l] of Object.entries(data.layouts)) lsel.appendChild(new Option(l.label, name));
  const rsel = $('ov-role');
  for (const g of data.groups) {
    const og = document.createElement('optgroup');
    og.label = g.label;
    for (const [id, role] of Object.entries(data.roles)) if (role.group === g.id) og.appendChild(new Option(role.label, id));
    rsel.appendChild(og);
  }

  $('cast-toggle').addEventListener('click', () => openPanel(panel.hidden));
  $('cast-close').addEventListener('click', () => openPanel(false));
  $('cast-save').addEventListener('click', save);
  $('cast-copy').addEventListener('click', copyJson);
  $('cast-revert').addEventListener('click', revert);
  window.addEventListener('beforeunload', (ev) => { if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; } });

  // Uncast warning shown up front so it is not a surprise.
  placeBars();
  renderPanel();
  openPanel(wide.matches);

  // Test hook (dev only): lets the browser console inspect what would be posted.
  window.__cast = { get data() { return data; }, jsonText, makePlan, castRole, renderPanel };
  return { onOpen, filter };
}
