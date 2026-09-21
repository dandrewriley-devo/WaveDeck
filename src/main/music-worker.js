const { parentPort, workerData } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');
const { extractTrack, normalize } = require('./music-tags');
let db, parseFile, scanning = null;
const root = path.join(path.dirname(workerData.dataDir), 'Music');
const dbPath = path.join(workerData.dataDir, 'music.sqlite');
let status = { scanning: false, count: 0, checked: 0, errors: 0, folder: root, message: '' };
const rows = (sql, params = []) => {
  const statement = db.prepare(sql);
  try { statement.bind(params); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
};
const emit = () => parentPort.postMessage({ event: 'status', value: status });
async function persist() {
  await fs.writeFile(dbPath + '.tmp', db.export());
  await fs.rename(dbPath + '.tmp', dbPath);
}
async function scan() {
  if (scanning) return scanning;
  scanning = (async () => {
    status = { ...status, scanning: true, checked: 0, errors: 0, message: '' }; emit();
    try {
      await fs.mkdir(root, { recursive: true });
      const seen = new Set();
      let complete = true;
      async function walk(directory) {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch { complete = false; status.errors++; return; }
        for (const entry of entries) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { await walk(file); continue; }
          // Do not follow symlinks outside the portable music tree.
          if (!entry.isFile() || !/\.mp3$/i.test(entry.name)) continue;
          const relative = path.relative(root, file).split(path.sep).join('/');
          seen.add(relative);
          try {
            const stat = await fs.stat(file);
            const old = rows('SELECT size, mtime FROM tracks WHERE path = ?', [relative])[0];
            if (!old || old.size !== stat.size || old.mtime !== stat.mtimeMs) {
              const metadata = await parseFile(file, { skipCovers: true, duration: true });
              const track = extractTrack(metadata, relative);
              const search = normalize([track.title, track.artist, track.albumArtist, track.album, track.year,
                ...track.genres, ...track.composer, ...track.comments, track.track, track.disc, relative].join(' '));
              db.run('INSERT OR REPLACE INTO tracks VALUES (?, ?, ?, ?, ?, ?)',
                [relative, track.id, stat.size, stat.mtimeMs, JSON.stringify(track), search]);
            }
          } catch { status.errors++; }
          status.checked++;
          if (status.checked % 100 === 0) emit();
        }
      }
      await walk(root);
      if (complete) for (const row of rows('SELECT path FROM tracks')) {
        if (!seen.has(row.path)) db.run('DELETE FROM tracks WHERE path = ?', [row.path]);
      }
      await persist();
      status.count = rows('SELECT COUNT(*) AS n FROM tracks')[0].n;
      status.message = status.errors ? `${status.errors} files or folders could not be read; rescan to retry.` : '';
    } catch (error) { status.message = error.message; }
    finally { status.scanning = false; scanning = null; emit(); }
    return status;
  })();
  return scanning;
}
async function initialize() {
  const SQL = await require('sql.js')();
  ({ parseFile } = await import('music-metadata'));
  await fs.mkdir(workerData.dataDir, { recursive: true });
  let bytes;
  try { bytes = await fs.readFile(dbPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  db = new SQL.Database(bytes);
  db.run('CREATE TABLE IF NOT EXISTS tracks (path TEXT PRIMARY KEY, id TEXT UNIQUE, size REAL, mtime REAL, json TEXT, search TEXT)');
  status.count = rows('SELECT COUNT(*) AS n FROM tracks')[0].n;
  emit();
}
const ready = initialize();
ready.catch(() => {});
parentPort.on('message', async ({ id, method, args = [] }) => {
  try {
    await ready;
    let value;
    if (method === 'scan') value = await scan();
    else if (method === 'status') value = status;
    else if (method === 'all') value = rows('SELECT json FROM tracks').map(r => JSON.parse(r.json));
    else if (method === 'search') {
      const words = normalize(args[0]).slice(0, 500).split(/\s+/).filter(Boolean);
      const where = words.length ? ' WHERE ' + words.map(() => 'instr(search, ?) > 0').join(' AND ') : '';
      const total = rows('SELECT COUNT(*) AS n FROM tracks' + where, words)[0].n;
      value = { total, tracks: words.length ? rows('SELECT json FROM tracks' + where + ' ORDER BY search LIMIT 200', words).map(r => JSON.parse(r.json)) : [] };
    } else throw new Error('Unknown music request.');
    parentPort.postMessage({ id, value });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
