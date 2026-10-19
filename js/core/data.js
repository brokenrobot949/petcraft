// Loads the data/*.json files. Add a name here when a phase adds a data file (and add the file to sw.js).
const DATA_FILES = ['balance', 'sprites'];

export async function loadData() {
  const entries = await Promise.all(
    DATA_FILES.map(async (name) => {
      const res = await fetch(`data/${name}.json`);
      if (!res.ok) throw new Error(`could not load data/${name}.json (${res.status})`);
      return [name, await res.json()];
    }),
  );
  return Object.fromEntries(entries);
}
