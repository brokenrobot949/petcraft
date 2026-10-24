// Dev only: runs one simulation in a Web Worker so long runs don't freeze the page.
// postMessage({ days, seed, player, patch, keepState }) -> { result } or { error }.
// patch (optional) is JavaScript source run as (d) => { ... } on a copy of the data before the run,
// so balance changes can be tried without editing data/balance.json.
import { loadData } from '../../js/core/data.js';
import { runSim } from './sim.js';

// loadData fetches 'data/x.json' relative to the page; in a worker that is tools/sim/, so point it at the repo root.
const root = new URL('../../', self.location.href);
const fetchPage = self.fetch.bind(self);
self.fetch = (url, opts) => fetchPage(typeof url === 'string' && !/^[a-z]+:|^\//.test(url) ? new URL(url, root) : url, opts);

const dataPromise = loadData();

self.onmessage = async (e) => {
  const { days = 30, seed = 12345, player = 'regular', patch = '', keepState = false } = e.data || {};
  try {
    const data = structuredClone(await dataPromise);
    if (patch) new Function('d', patch)(data);
    const result = runSim(data, { days, seed, player, keepState });
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err && err.stack || err) });
  }
};
