const { parentPort, workerData } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');
const { extractTrack, normalize } = require('./music-tags');
let db, parseFile, scanning = null;
let lastFmWrites = 0;
const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const FULL_REFRESH_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const MUSIC_INDEX_VERSION = 2;
const portableRoot = path.join(path.dirname(workerData.dataDir), 'Music');
let additionalMusicFolder = String(workerData.additionalMusicFolder || '').trim();
const dbPath = path.join(workerData.dataDir, 'music.sqlite');
let status = { scanning: false, count: 0, checked: 0, errors: 0, folder: portableRoot, message: '' };
let refreshAllTrackMetadata = false;
const rows = (sql, params = []) => {
  const statement = db.prepare(sql);
  try { statement.bind(params); const result = []; while (statement.step()) result.push(statement.getAsObject()); return result; }
  finally { statement.free(); }
};
const emit = () => parentPort.postMessage({ event: 'status', value: status });
const albumKey = track => {
  const artist = normalize(track.albumArtist || track.artist);
  const album = normalize(track.album || track.title);
  return `${artist}\n${album}`;
};
const merge = (...values) => [...new Set(values.flat().map(String).map(value => value.trim()).filter(Boolean))];
function lastFmMaps() {
  const tracks = new Map(rows('SELECT * FROM lastfm_tracks').map(row => [row.id, row]));
  const artists = new Map(rows('SELECT * FROM lastfm_artists').map(row => [row.artist_key, row]));
  return { tracks, artists };
}
function withLastFm(track, maps = lastFmMaps()) {
  const entry = maps.tracks.get(track.id);
  const artistEntries = merge(track.artists || [track.artist]).map(artist => maps.artists.get(normalize(artist))).filter(Boolean);
  const similarArtists = merge(track.similarArtists || [], ...artistEntries.map(entry => {
    try { return JSON.parse(entry.similar_json || '[]'); } catch { return []; }
  }));
  if (!entry || entry.status !== 'matched') {
    return { ...track, similarArtists, lastFm: { source: 'tag', status: entry?.status || 'unchecked', updatedAt: entry?.updated_at || '' } };
  }
  let tags = [];
  try { tags = JSON.parse(entry.tags_json || '[]'); } catch {}
  const popularity = Number(entry.popularity);
  return {
    ...track,
    popularity: Number.isFinite(popularity) ? popularity : track.popularity,
    genres: merge(track.genres || [], tags),
    similarArtists,
    lastFm: {
      source: 'lastfm', status: 'matched', updatedAt: String(entry.updated_at || ''),
      listeners: Number(entry.listeners) || 0, playCount: Number(entry.playcount) || 0,
      popularity: Number.isFinite(popularity) ? popularity : null
    }
  };
}
function storedTracks() { return rows('SELECT json FROM tracks').map(row => JSON.parse(row.json)); }
function trackById(id) { return storedTracks().find(track => track.id === String(id)) || null; }
function lastFmCurrent(entry, now = Date.now()) {
  return entry?.status === 'matched' && Date.parse(entry.updated_at || '') > now - SIX_MONTHS_MS;
}
function lastFmNeedsRefresh(entry, now = Date.now(), force = false) {
  if (force) return true;
  if (lastFmCurrent(entry, now)) return false;
  const retryAt = Date.parse(entry?.retry_after || '');
  return !Number.isFinite(retryAt) || retryAt <= now;
}
function lastFmNeedsFullRefresh(entry, now = Date.now()) {
  const checkedAt = Date.parse(entry?.last_attempt_at || entry?.updated_at || '');
  return !Number.isFinite(checkedAt) || checkedAt <= now - FULL_REFRESH_RECHECK_MS;
}
async function persistLastFm(force = false) {
  if (!force && lastFmWrites % 10 !== 0) return;
  await persist();
}
function upsertLastFmTrack(value) {
  db.run(`INSERT OR REPLACE INTO lastfm_tracks
    (id, artist, title, album_key, listeners, playcount, popularity, tags_json, updated_at, last_attempt_at, retry_after, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    String(value.id), String(value.artist || ''), String(value.title || ''), String(value.albumKey || ''),
    Number(value.listeners) || 0, Number(value.playCount) || 0, value.popularity === null ? null : Number(value.popularity),
    JSON.stringify(Array.isArray(value.tags) ? value.tags : []), String(value.updatedAt || ''), String(value.lastAttemptAt || ''),
    String(value.retryAfter || ''), String(value.status || 'unchecked')
  ]);
}
function upsertLastFmArtist(value) {
  db.run(`INSERT OR REPLACE INTO lastfm_artists
    (artist_key, artist, similar_json, updated_at, last_attempt_at, retry_after, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    normalize(value.artist), String(value.artist || ''), JSON.stringify(Array.isArray(value.similarArtists) ? value.similarArtists : []),
    String(value.updatedAt || ''), String(value.lastAttemptAt || ''), String(value.retryAfter || ''), String(value.status || 'unchecked')
  ]);
}
async function persist() {
  await fs.writeFile(dbPath + '.tmp', db.export());
  await fs.rename(dbPath + '.tmp', dbPath);
}
async function scan() {
  if (scanning) return scanning;
  scanning = (async () => {
    status = { ...status, scanning: true, checked: 0, errors: 0, message: '' }; emit();
    try {
      await fs.mkdir(portableRoot, { recursive: true });
      const seen = new Set();
      const completeRoots = new Set();
      const roots = [{ id: 'portable', folder: portableRoot }];
      if (additionalMusicFolder && path.resolve(additionalMusicFolder) !== path.resolve(portableRoot)) {
        roots.push({ id: 'additional', folder: additionalMusicFolder });
      }
      async function walk(directory, root) {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch { status.errors++; return false; }
        for (const entry of entries) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { if (!await walk(file, root)) return false; continue; }
          // Do not follow symlinks outside a selected music tree.
          if (!entry.isFile() || !/\.mp3$/i.test(entry.name)) continue;
          const relative = path.relative(root.folder, file).split(path.sep).join('/');
          const key = `${root.id}:${relative}`;
          seen.add(key);
          try {
            const stat = await fs.stat(file);
            const old = rows('SELECT size, mtime FROM tracks WHERE path = ?', [key])[0];
            if (refreshAllTrackMetadata || !old || old.size !== stat.size || old.mtime !== stat.mtimeMs) {
              const metadata = await parseFile(file, { skipCovers: true, duration: true });
              const track = extractTrack(metadata, relative, root.id);
              const search = normalize([track.title, track.artist, track.albumArtist, track.album, track.year,
                ...track.genres, ...track.composer, ...track.comments, track.track, track.disc, relative].join(' '));
              db.run('INSERT OR REPLACE INTO tracks VALUES (?, ?, ?, ?, ?, ?)',
                [key, track.id, stat.size, stat.mtimeMs, JSON.stringify(track), search]);
            }
          } catch { status.errors++; }
          status.checked++;
          if (status.checked % 100 === 0) emit();
        }
        return true;
      }
      for (const root of roots) {
        if (await walk(root.folder, root)) completeRoots.add(root.id);
      }
      for (const row of rows('SELECT path FROM tracks')) {
        const library = /^(portable|additional):/.test(String(row.path))
          ? String(row.path).split(':', 1)[0]
          : 'portable';
        if (completeRoots.has(library) && !seen.has(row.path)) db.run('DELETE FROM tracks WHERE path = ?', [row.path]);
      }
      db.run('DELETE FROM lastfm_tracks WHERE id NOT IN (SELECT id FROM tracks)');
      if (refreshAllTrackMetadata && completeRoots.size === roots.length) {
        db.run('INSERT OR REPLACE INTO music_index_meta (key, value) VALUES (?, ?)', ['track_metadata_version', String(MUSIC_INDEX_VERSION)]);
        refreshAllTrackMetadata = false;
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
  db.run('CREATE TABLE IF NOT EXISTS music_index_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS lastfm_tracks (id TEXT PRIMARY KEY, artist TEXT, title TEXT, album_key TEXT, listeners REAL, playcount REAL, popularity REAL, tags_json TEXT, updated_at TEXT, last_attempt_at TEXT, retry_after TEXT, status TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS lastfm_artists (artist_key TEXT PRIMARY KEY, artist TEXT, similar_json TEXT, updated_at TEXT, last_attempt_at TEXT, retry_after TEXT, status TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS lastfm_jobs (album_key TEXT PRIMARY KEY, priority INTEGER, force INTEGER, queued_at TEXT)');
  const metadataVersion = Number(rows('SELECT value FROM music_index_meta WHERE key = ?', ['track_metadata_version'])[0]?.value) || 0;
  refreshAllTrackMetadata = metadataVersion < MUSIC_INDEX_VERSION;
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
    else if (method === 'set-roots') {
      additionalMusicFolder = String(args[0] || '').trim();
      db.run("DELETE FROM tracks WHERE path LIKE 'additional:%'");
      await persist();
      status.count = rows('SELECT COUNT(*) AS n FROM tracks')[0].n;
      value = status;
    }
    else if (method === 'all') {
      const maps = lastFmMaps(); value = storedTracks().map(track => withLastFm(track, maps));
    }
    else if (method === 'search') {
      const words = normalize(args[0]).slice(0, 500).split(/\s+/).filter(Boolean);
      const where = words.length ? ' WHERE ' + words.map(() => 'instr(search, ?) > 0').join(' AND ') : '';
      const total = rows('SELECT COUNT(*) AS n FROM tracks' + where, words)[0].n;
      const maps = lastFmMaps();
      value = { total, tracks: words.length ? rows('SELECT json FROM tracks' + where + ' ORDER BY search LIMIT 200', words).map(r => withLastFm(JSON.parse(r.json), maps)) : [] };
    } else if (method === 'lastfm:queue-album') {
      const track = trackById(args[0]);
      if (!track) throw new Error('That song is no longer indexed. Rescan Music.');
      db.run('INSERT OR REPLACE INTO lastfm_jobs VALUES (?, ?, ?, ?)', [albumKey(track), 100, 0, new Date().toISOString()]);
      await persist(); value = true;
    } else if (method === 'lastfm:queue-full') {
      const now = Date.now();
      const queuedAt = new Date(now).toISOString();
      const tracks = storedTracks();
      const maps = lastFmMaps();
      db.run('BEGIN TRANSACTION');
      try {
        // This is a catch-up sweep, not a needless restart. Albums whose tracks
        // were checked within the past week are left alone.
        for (const key of new Set(tracks.map(albumKey))) {
          const albumNeedsRefresh = tracks.some(track => albumKey(track) === key && lastFmNeedsFullRefresh(maps.tracks.get(track.id), now));
          if (albumNeedsRefresh) db.run('INSERT OR REPLACE INTO lastfm_jobs VALUES (?, ?, ?, ?)', [key, 10, 2, queuedAt]);
        }
        db.run('COMMIT');
      } catch (error) { db.run('ROLLBACK'); throw error; }
      await persist(); value = true;
    } else if (method === 'lastfm:next') {
      const maps = lastFmMaps(); const tracks = storedTracks(); const now = Date.now();
      const job = rows('SELECT * FROM lastfm_jobs ORDER BY priority DESC, queued_at ASC LIMIT 1')[0];
      let key = job?.album_key || '';
      const refreshMode = Number(job?.force) || 0;
      const force = refreshMode === 1;
      const fullRefresh = refreshMode === 2;
      if (!key) {
        const candidate = tracks.find(track => lastFmNeedsRefresh(maps.tracks.get(track.id), now));
        if (!candidate) { value = null; parentPort.postMessage({ id, value }); return; }
        key = albumKey(candidate);
      }
      const album = tracks.filter(track => albumKey(track) === key);
      const artists = merge(...album.map(track => track.artists || [track.artist]));
      value = {
        albumKey: key, force, queued: Boolean(job),
        tracks: album.filter(track => fullRefresh
          ? lastFmNeedsFullRefresh(maps.tracks.get(track.id), now)
          : lastFmNeedsRefresh(maps.tracks.get(track.id), now, force)),
        // Artist data is shared by many albums, so do not ask Last.fm for the
        // same artist over and over during a library sweep.
        artists: artists.filter(artist => lastFmNeedsRefresh(maps.artists.get(normalize(artist)), now))
      };
    } else if (method === 'lastfm:update-track') {
      upsertLastFmTrack(args[0] || {}); lastFmWrites++; await persistLastFm(); value = true;
    } else if (method === 'lastfm:update-artist') {
      upsertLastFmArtist(args[0] || {}); lastFmWrites++; await persistLastFm(); value = true;
    } else if (method === 'lastfm:complete') {
      db.run('DELETE FROM lastfm_jobs WHERE album_key = ?', [String(args[0] || '')]);
      await persist(); value = true;
    } else if (method === 'lastfm:status') {
      const maps = lastFmMaps(); const tracks = storedTracks(); const now = Date.now();
      value = {
        tracksTotal: tracks.length,
        tracksCurrent: tracks.filter(track => lastFmCurrent(maps.tracks.get(track.id), now)).length,
        tracksMatched: tracks.filter(track => maps.tracks.get(track.id)?.status === 'matched').length,
        queuedAlbums: Number(rows('SELECT COUNT(*) AS n FROM lastfm_jobs')[0].n) || 0
      };
    } else throw new Error('Unknown music request.');
    parentPort.postMessage({ id, value });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
