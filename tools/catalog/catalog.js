const PACK = '../../assets-source/ninja-adventure/Ninja%20Adventure%20-%20Asset%20Pack/';
const BOX = 96;
const $ = (id) => document.getElementById(id);
const main = $('main');

const urlFor = (p) => PACK + p.split('/').map(encodeURIComponent).join('/');
const intScale = (w, h, box) => Math.max(1, Math.floor(Math.min(box / w, box / h)));

let files = [];
let sections = []; // {catDet, subDet, tiles:[{el, e, hay}]}

function showMessage(html) {
  main.innerHTML = `<div class="msg">${html}</div>`;
}

async function load() {
  try {
    const r = await fetch('files.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    files = await r.json();
  } catch (err) {
    showMessage('<b>files.json not found.</b><br>Run this from the repo root, then reload:<br>' +
      '<code>powershell -ExecutionPolicy Bypass -File tools/catalog/build-index.ps1</code><br>' +
      'Also make sure you opened this page through the server (<code>tools/serve.ps1 -Port 8080</code>), not as a file.');
    return;
  }
  build();
}

function makeTile(e) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.tabIndex = 0;
  tile.title = e.path;
  const box = document.createElement('div');
  box.className = 'box';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = e.path;
  img.src = urlFor(e.path);
  const s = intScale(e.width || 1, e.height || 1, BOX);
  if (e.width && e.height) {
    if (e.width * s <= BOX && e.height * s <= BOX) {
      img.style.width = e.width * s + 'px';
      img.style.height = e.height * s + 'px';
    } else {
      // larger than the box: shrink to fit
      img.style.maxWidth = BOX + 'px';
      img.style.maxHeight = BOX + 'px';
    }
  }
  box.appendChild(img);
  const parts = e.path.split('/');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = parts.pop();
  const dir = document.createElement('div');
  dir.className = 'dir';
  dir.textContent = parts.join('/') || '(top level)';
  tile.append(box, name, dir);
  tile.addEventListener('click', () => openOverlay(e));
  tile.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openOverlay(e); });
  return tile;
}

function build() {
  main.innerHTML = '';
  const cats = new Map();
  for (const e of files) {
    if (!cats.has(e.category)) cats.set(e.category, new Map());
    const subs = cats.get(e.category);
    if (!subs.has(e.subcategory)) subs.set(e.subcategory, []);
    subs.get(e.subcategory).push(e);
  }
  const sel = $('category');
  for (const c of cats.keys()) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  }
  for (const [cat, subs] of cats) {
    const catDet = document.createElement('details');
    catDet.className = 'cat';
    catDet.open = true;
    const catSum = document.createElement('summary');
    catDet.appendChild(catSum);
    const group = { cat, catDet, catSum, subs: [] };
    for (const [sub, list] of subs) {
      let host = catDet, subDet = null, subSum = null;
      const grid = document.createElement('div');
      grid.className = 'grid';
      if (sub) {
        subDet = document.createElement('details');
        subDet.className = 'sub';
        subDet.open = list.length <= 150;
        subSum = document.createElement('summary');
        subDet.append(subSum, grid);
        host.appendChild(subDet);
      } else {
        host.appendChild(grid);
      }
      const tiles = list.map((e) => {
        const el = makeTile(e);
        grid.appendChild(el);
        return { el, hay: e.path.toLowerCase() };
      });
      group.subs.push({ sub, subDet, subSum, tiles });
    }
    main.appendChild(catDet);
    sections.push(group);
  }
  applyFilter();
}

function applyFilter() {
  const q = $('filter').value.trim().toLowerCase();
  const cat = $('category').value;
  let visible = 0;
  for (const g of sections) {
    let catCount = 0;
    const catOk = !cat || cat === g.cat;
    for (const s of g.subs) {
      let n = 0;
      for (const t of s.tiles) {
        const show = catOk && (!q || t.hay.includes(q));
        t.el.hidden = !show;
        t.el.style.display = show ? '' : 'none';
        if (show) n++;
      }
      catCount += n;
      if (s.subDet) {
        s.subDet.style.display = n ? '' : 'none';
        s.subSum.innerHTML = '';
        s.subSum.append(s.sub + ' ', countSpan(n, s.tiles.length));
      }
    }
    g.catDet.style.display = catCount ? '' : 'none';
    g.catSum.innerHTML = '';
    g.catSum.append(g.cat + ' ', countSpan(catCount, g.subs.reduce((a, s) => a + s.tiles.length, 0)));
    visible += catCount;
  }
  $('counts').textContent = `${visible} shown / ${files.length} total`;
}

function countSpan(n, total) {
  const sp = document.createElement('span');
  sp.className = 'count';
  sp.textContent = n === total ? `(${total})` : `(${n} of ${total})`;
  return sp;
}

let currentPath = '';
function openOverlay(e) {
  currentPath = e.path;
  const img = $('ov-img');
  const s = Math.max(1, Math.min(8, intScale(e.width || 1, e.height || 1, 512)));
  img.src = urlFor(e.path);
  img.style.width = (e.width || 0) * s + 'px';
  img.style.height = (e.height || 0) * s + 'px';
  img.alt = e.path;
  $('ov-path').textContent = e.path;
  $('ov-dim').textContent = `${e.width} x ${e.height} px (shown at ${s}x)`;
  $('ov-open').href = urlFor(e.path);
  $('ov-copy').textContent = 'Copy path';
  $('overlay').hidden = false;
}
function closeOverlay() { $('overlay').hidden = true; }

$('ov-close').addEventListener('click', closeOverlay);
$('overlay').addEventListener('click', (ev) => { if (ev.target.id === 'overlay') closeOverlay(); });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeOverlay(); });
$('ov-copy').addEventListener('click', async () => {
  const btn = $('ov-copy');
  try {
    await navigator.clipboard.writeText(currentPath);
    btn.textContent = 'Copied!';
  } catch {
    const r = document.createRange();
    r.selectNodeContents($('ov-path'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    btn.textContent = 'Selected - press Ctrl+C';
  }
});
$('filter').addEventListener('input', applyFilter);
$('category').addEventListener('change', applyFilter);

load();
