// A pet's scrapbook (Phase 11): the entries the pets system wrote (pet.book, or an elder's record), shown as
// dated lines. Words come from pets.json lines.book. Used on the pet page and in the Elder Grove.
import { el, fold } from './dom.js';
import { itemLabel } from '../systems/bag.js';
import { talentDef } from '../systems/petstats.js';

const fmt = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

function entryText(data, e) {
  const w = data.pets.lines.book;
  const zone = (id) => data.zones.zones.find((z) => z.id === id)?.name || id;
  switch (e.k) {
    case 'home': {
      const how = fmt(w.home[e.how] || w.home.other, { zone: zone(e.zone) });
      const q = data.pets.qualities.find((x) => x.id === e.quality)?.name;
      return q ? `${how} ${fmt(w.quality, { quality: q })}` : how;
    }
    case 'heart': return fmt(w.heart, { n: e.n });
    case 'evolved': return e.species ? fmt(w.evolved, { species: e.species }) : null;
    case 'favorite': return fmt(w.favorite, { item: itemLabel(data, e.item) });
    case 'rare': return fmt(w.rare, { item: itemLabel(data, e.item), zone: zone(e.zone) });
    case 'talent': return fmt(w.talent, { talent: talentDef(data, e.talent)?.name || e.talent });
    case 'play': return w.play;
    case 'wish': return w.wish?.[e.kind] ? fmt(w.wish[e.kind], {
      item: e.item ? itemLabel(data, e.item) : '', zone: e.zone ? zone(e.zone) : '', buddy: e.buddy || 'a friend',
    }) : null;
    case 'postcard': {
      const text = data.trips?.postcards?.[e.zone]?.[e.line];
      return text ? fmt(w.postcard, { zone: zone(e.zone), text }) : null;
    }
    case 'trick': return fmt(w.trick, { trick: data.tricks?.tricks.find((t) => t.id === e.trick)?.name || e.trick });
    case 'retired': return w.retired;
    default: return w[e.k] && typeof w[e.k] === 'string' ? fmt(w[e.k], e) : null; // later phases' entries
  }
}

function dateText(data, t) {
  if (!t) return data.pets.lines.book.undated;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A fold-away panel listing the entries, newest last. foldKey: remembered open/closed per device.
export function scrapbookPanel(data, book, foldKey, title = 'Scrapbook') {
  const rows = (book || []).map((e) => ({ e, text: entryText(data, e) })).filter((r) => r.text);
  const list = rows.length
    ? el('ol.pet-book', {}, rows.map(({ e, text }) => el('li', {},
      el('span.pet-book-date.small.muted', {}, dateText(data, e.t)),
      el('span.pet-book-text', {}, text))))
    : el('p.small.muted', {}, 'Nothing here yet.');
  return el('div.panel', {}, fold(foldKey, `${title} (${rows.length})`, list));
}
