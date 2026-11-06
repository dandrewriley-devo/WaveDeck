const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Worker } = require('worker_threads');
const initSqlJs = require('sql.js');

const INTRO_TEMPLATES = [
  'This is [artist] with “[title].”',
  'Up next, [artist] and “[title].”',
  'Here’s [artist] with “[title].”'
];
const OUTRO_TEMPLATES = [
  'That was “[title]” by [artist].',
  'You just heard “[title]” by [artist].',
  '[artist] there with “[title].”'
];
const CLIP_BITRATE = '48k';
const voiceFor = () => 'af_heart';
const LASTFM_MINIMUM = 70;

const cleanText = value => String(value || '').replace(/\s+/g, ' ').replace(/“\s+/g, '“').trim();
const sourceRelative = track => String(track?.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
const contentHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function sourceStem(relativePath) {
  const parsed = path.posix.parse(relativePath);
  return { parent: parsed.dir === '.' ? '' : parsed.dir, stem: parsed.name || 'untitled' };
}

function clipRelativePath(track, kind, slot) {
  const source = sourceStem(sourceRelative(track));
  return path.posix.join('tracks', source.parent, `${source.stem}__${kind}-${String(slot).padStart(2, '0')}.opus`);
}

function templateText(template, track, pronunciation = '', titleHint = '') {
  return cleanText(String(template)
    .replaceAll('[artist]', cleanText(pronunciation || track?.artist || track?.albumArtist || 'Unknown Artist'))
    .replaceAll('[title]', cleanText(titleHint || track?.title || 'Untitled')));
}
function stationIdText(template, settings) { return cleanText(String(template).replace(/\[xl\]/gi, '').replaceAll('[station]', cleanText(settings.stationName)).replaceAll('[dj]', cleanText(settings.djName))); }

class DjClips {
  constructor({ dataDir, getTracks, ffmpegPath, getModelDir, getSettings = () => ({}), onStatus = () => {} }) {
    this.dataDir = dataDir;
    this.root = path.join(path.dirname(dataDir), 'DJ Clips');
    this.getTracks = getTracks;
    this.ffmpegPath = ffmpegPath;
    this.getModelDir = getModelDir;
    this.getSettings = getSettings;
    this.onStatus = onStatus;
    this.db = null; this.SQL = null; this.worker = null; this.workerReady = null; this.requests = new Map();
    this.running = false; this.timer = null; this.cancelAfterClip = false; this.progressUpdatedAt = 0;
    this.stationIdDeck = []; this.stationIdDeckSignature = ''; this.lastPlayedStationIdSlot = 0;
    this.extraDeck = []; this.extraDeckSignature = ''; this.lastExtraSlot = 0;
    this.quietUntil = 0;
    this.status = { ready: false, state: 'idle', queued: 0, completed: 0, total: 0, created: 0, reused: 0, progress: { ready: 0, total: 0 }, message: 'Auto DJ is off.' };
  }
  async start() {
    if (this.db) return;
    await fsp.mkdir(this.root, { recursive: true });
    this.SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const file = path.join(this.root, 'clips.sqlite');
    let bytes = null; try { bytes = await fsp.readFile(file); } catch {}
    this.db = bytes ? new this.SQL.Database(bytes) : new this.SQL.Database();
    // This sql.js database is memory-backed and persisted as a complete export.
    // WAL sidecars are unsupported here and can leave the in-memory connection
    // in a disk-I/O error state during otherwise read-only clip lookups.
    this.db.run('PRAGMA journal_mode=DELETE');
    this.db.run('CREATE TABLE IF NOT EXISTS clips (source_path TEXT NOT NULL, kind TEXT NOT NULL, slot INTEGER NOT NULL, output_path TEXT NOT NULL, signature TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(source_path, kind, slot))');
    this.db.run('CREATE TABLE IF NOT EXISTS jobs (track_id TEXT PRIMARY KEY, manual INTEGER NOT NULL DEFAULT 0, requested INTEGER NOT NULL)');
    this.db.run('CREATE TABLE IF NOT EXISTS station_ids (slot INTEGER PRIMARY KEY, signature TEXT NOT NULL, created INTEGER NOT NULL)');
    this.db.run('CREATE TABLE IF NOT EXISTS extra_lines (slot INTEGER PRIMARY KEY, signature TEXT NOT NULL, created INTEGER NOT NULL)');
    await this.save();
    this.schedule(15_000);
    this.status = { ...this.status, ready: true, message: this.enabled() ? this.enabledMessage() : 'Auto DJ is off.' }; this.emit();
    if (this.enabled()) this.schedule(15_000);
  }
  emit() { this.onStatus({ ...this.status }); }
  async save() {
    if (!this.db) return;
    const target = path.join(this.root, 'clips.sqlite'); const temporary = `${target}.part`;
    await fsp.writeFile(temporary, Buffer.from(this.db.export())); await fsp.rename(temporary, target);
  }
  rows(sql, values = []) {
    const statement = this.db.prepare(sql); statement.bind(values); const rows = [];
    while (statement.step()) rows.push(statement.getAsObject()); statement.free(); return rows;
  }
  portableTrack(id) { return this.getTracks().find(track => track.library === 'portable' && track.id === String(id)); }
  settings() { const value = this.getSettings() || {}; return { enabled: value.autoDjEnabled === true, stationName: value.autoDjStationName || '', djName: value.autoDjName || '', voice: 'female', stationIds: Array.isArray(value.autoDjStationIds) ? value.autoDjStationIds : [], extraLines: Array.isArray(value.autoDjExtraLines) ? value.autoDjExtraLines : [], pronunciations: value.autoDjArtistPronunciations || {}, titleHints: value.autoDjTitlePronunciations || {} }; }
  enabled() { return this.settings().enabled; }
  enabledMessage() { const settings = this.settings(); return settings.stationName && settings.djName ? 'Auto DJ is ready.' : 'Auto DJ is ready. Add Station Name and DJ Name before Station IDs can generate.'; }
  settingsChanged() { if (this.enabled()) { this.status = { ...this.status, message: this.enabledMessage() }; this.emit(); this.schedule(200); } else { clearTimeout(this.timer); this.status = { ...this.status, state: 'idle', message: 'Auto DJ is off.' }; this.emit(); } }
  qualifying(track) { return track?.library === 'portable' && track?.lastFm?.status === 'matched' && Number(track.lastFm?.popularity) >= LASTFM_MINIMUM; }
  async queueTrack(id, { manual = false } = {}) {
    await this.start(); if (!this.enabled()) return this.getStatus(); const track = this.portableTrack(id); if (!track) throw new Error('That portable track is no longer available.');
    const current = this.rows('SELECT manual FROM jobs WHERE track_id = ?', [track.id])[0];
    this.db.run('INSERT OR REPLACE INTO jobs(track_id, manual, requested) VALUES (?, ?, ?)', [track.id, manual || Number(current?.manual) ? 1 : 0, Date.now()]);
    await this.save(); this.schedule(500); await this.refreshQueueStatus(); return this.getStatus();
  }
  async queueQualifyingTracks() {
    await this.start(); if (!this.enabled()) return { ...this.getStatus(), queuedNow: 0 }; let queued = 0;
    for (const track of this.getTracks()) {
      if (!this.qualifying(track)) continue;
      this.db.run('INSERT OR IGNORE INTO jobs(track_id, manual, requested) VALUES (?, 0, ?)', [track.id, Date.now()]); queued += 1;
    }
    await this.save(); this.schedule(500); await this.refreshQueueStatus();
    return { ...this.getStatus(), queuedNow: queued };
  }
  async observeLastFm(track) { if (this.enabled() && this.qualifying(track)) await this.queueTrack(track.id); }
  schedule(delay = 1500) { clearTimeout(this.timer); this.timer = setTimeout(() => void this.resume(), Math.max(delay, this.quietUntil - Date.now())); this.timer.unref?.(); }
  deferForPlayback() { this.quietUntil = Date.now() + 10_000; this.cancelAfterClip = true; this.schedule(10_000); }
  async refreshQueueStatus() {
    if (!this.db) return;
    const queued = Number(this.rows('SELECT COUNT(*) AS count FROM jobs')[0]?.count) || 0;
    this.refreshLibraryProgress();
    this.status = { ...this.status, queued }; this.emit();
  }
  refreshLibraryProgress(force = false) {
    if (!this.db || (!force && Date.now() - this.progressUpdatedAt < 15_000)) return;
    const tracks = this.getTracks().filter(track => track.library === 'portable');
    const readyPaths = new Set(this.rows('SELECT source_path FROM clips GROUP BY source_path HAVING COUNT(*) >= 6').map(row => row.source_path));
    const queuedIds = new Set(this.rows('SELECT track_id FROM jobs').map(row => String(row.track_id)));
    let total = 0, ready = 0;
    for (const track of tracks) {
      const done = readyPaths.has(sourceRelative(track));
      if (!this.qualifying(track) && !done && !queuedIds.has(String(track.id))) continue;
      total += 1;
      if (done) ready += 1;
    }
    this.status.progress = { ready, total };
    this.progressUpdatedAt = Date.now();
  }
  async resume() {
    if (this.running) return;
    await this.start(); if (!this.enabled()) return;
    if (Date.now() < this.quietUntil) return this.schedule(10_000);
    const station = this.nextStationId();
    if (station) { this.running = true; try { await this.renderStationId(station); } finally { this.running = false; this.schedule(300); } return; }
    const extra = this.nextExtraLine();
    if (extra) { this.running = true; try { await this.renderExtra(extra); } finally { this.running = false; this.schedule(300); } return; }
    const jobs = this.rows('SELECT * FROM jobs ORDER BY requested ASC LIMIT 1');
    if (!jobs.length) { await this.refreshQueueStatus(); return; }
    const job = jobs[0]; const track = this.portableTrack(job.track_id);
    if (!track) { this.db.run('DELETE FROM jobs WHERE track_id = ?', [job.track_id]); await this.save(); return this.schedule(100); }
    if (!Number(job.manual) && !this.qualifying(track)) { this.db.run('DELETE FROM jobs WHERE track_id = ?', [track.id]); await this.save(); return this.schedule(100); }
    this.running = true; this.cancelAfterClip = false;
    try {
      const result = await this.renderTrack(track);
      if (!result.cancelled && this.rows('SELECT requested FROM jobs WHERE track_id = ?', [track.id])[0]?.requested === job.requested) { this.db.run('DELETE FROM jobs WHERE track_id = ?', [track.id]); await this.save(); }
    } catch (error) {
      this.status = { ...this.status, state: 'paused', message: `DJ clips paused: ${error.message}` }; this.emit();
      this.schedule(30_000);
    } finally { this.running = false; await this.refreshQueueStatus(); if (!this.cancelAfterClip) this.schedule(1500); }
  }
  getStatus() { const settings = this.settings(); return { ...this.status, enabled: settings.enabled, settings, templates: { intros: 3, outros: 3 }, root: this.root, bitrate: CLIP_BITRATE, voice: voiceFor(settings), threshold: LASTFM_MINIMUM }; }
  async trackState(id) {
    await this.start(); const track = this.portableTrack(id); if (!track) return { state: 'missing' };
    const queued = this.rows('SELECT manual FROM jobs WHERE track_id = ?', [track.id])[0];
    if (queued) return { state: this.running ? 'generating' : 'queued', manual: Number(queued.manual) === 1 };
    const count = Number(this.rows('SELECT COUNT(*) AS count FROM clips WHERE source_path = ?', [sourceRelative(track)])[0]?.count) || 0;
    return { state: count >= 6 ? 'ready' : 'missing', manual: false };
  }
  async renderTrack(track) {
    const relative = sourceRelative(track); const clips = [
      ...INTRO_TEMPLATES.map((template, index) => ({ kind: 'intro', slot: index + 1, text: templateText(template, track, this.pronunciation(track.artist), this.settings().titleHints[track.id]) })),
      ...OUTRO_TEMPLATES.map((template, index) => ({ kind: 'outro', slot: index + 1, text: templateText(template, track, this.pronunciation(track.artist), this.settings().titleHints[track.id]) }))
    ];
    const sourceFile = path.join(path.dirname(this.dataDir), 'Music', ...relative.split('/'));
    const sourceStat = await fsp.stat(sourceFile);
    this.status = { ...this.status, state: 'generating', completed: 0, total: clips.length, created: 0, reused: 0, message: `Generating clips for ${track.artist || 'Unknown artist'}` }; this.emit();
    for (const clip of clips) {
      const outputRelative = clipRelativePath(track, clip.kind, clip.slot); const output = path.join(this.root, outputRelative);
      const signature = contentHash({ source: relative, bytes: sourceStat.size, modified: sourceStat.mtimeMs, kind: clip.kind, slot: clip.slot, text: clip.text, voice: voiceFor(this.settings()), bitrate: CLIP_BITRATE });
      const existing = this.rows('SELECT signature, output_path FROM clips WHERE source_path = ? AND kind = ? AND slot = ?', [relative, clip.kind, clip.slot])[0];
      let reused = existing?.signature === signature && existing.output_path === outputRelative;
      if (reused) { try { reused = (await fsp.stat(output)).isFile(); } catch { reused = false; } }
      if (reused) this.status.reused += 1;
      else {
        this.status.message = `Generating clips for ${track.artist || 'Unknown artist'}`; this.emit();
        await this.render(clip.text, output);
        this.db.run('INSERT OR REPLACE INTO clips(source_path, kind, slot, output_path, signature, created) VALUES (?, ?, ?, ?, ?, ?)', [relative, clip.kind, clip.slot, outputRelative, signature, Date.now()]);
        await this.save(); this.status.created += 1;
      }
      this.status.completed += 1; this.emit();
      if (this.cancelAfterClip) return { cancelled: true };
      await sleep(200);
    }
    this.status = { ...this.status, state: 'idle', message: `Generating clips for ${track.artist || 'Unknown artist'}` }; this.emit(); return { cancelled: false };
  }
  pronunciation(artist) { return this.settings().pronunciations[String(artist || '').trim().toLocaleLowerCase()] || ''; }
  async queueRegenerateTrack(id) {
    await this.start(); const track = this.portableTrack(id);
    if (!track) throw new Error('That portable track is no longer available.');
    const existing = this.rows('SELECT 1 FROM clips WHERE source_path = ? LIMIT 1', [sourceRelative(track)]).length;
    if (existing) {
      const previous = Number(this.rows('SELECT requested FROM jobs WHERE track_id = ?', [track.id])[0]?.requested) || 0;
      this.db.run('INSERT OR REPLACE INTO jobs(track_id, manual, requested) VALUES (?, 1, ?)', [track.id, Math.max(Date.now(), previous + 1)]);
      await this.save(); this.schedule(10_000); await this.refreshQueueStatus();
    }
    return Boolean(existing);
  }
  async queueArtist(artist) {
    await this.start(); const key = String(artist || '').trim().toLocaleLowerCase();
    for (const track of this.getTracks()) {
      if (track.library !== 'portable' || String(track.artist || '').trim().toLocaleLowerCase() !== key) continue;
      const existing = this.rows('SELECT 1 FROM clips WHERE source_path = ? LIMIT 1', [sourceRelative(track)]).length;
      if (existing) {
        const previous = Number(this.rows('SELECT requested FROM jobs WHERE track_id = ?', [track.id])[0]?.requested) || 0;
        this.db.run('INSERT OR REPLACE INTO jobs(track_id, manual, requested) VALUES (?, 1, ?)', [track.id, Math.max(Date.now(), previous + 1)]);
      }
    }
    await this.save(); this.schedule(10_000); await this.refreshQueueStatus();
  }
  async previewPronunciation(text) {
    await this.start(); this.deferForPlayback(); while (this.running) await sleep(200);
    const wav = path.join(this.root, `preview-${crypto.randomUUID()}.wav`);
    try { await this.speak(cleanText(text), wav); return (await fsp.readFile(wav)).toString('base64'); }
    finally { await fsp.rm(wav, { force: true }); }
  }
  nextExtraLine() {
    const settings = this.settings();
    for (let slot = 1; slot <= 40; slot += 1) {
      const text = cleanText(settings.extraLines[slot - 1]); if (!text) continue;
      const signature = contentHash({ slot, text, voice: voiceFor(), bitrate: CLIP_BITRATE });
      const output = path.join(this.root, 'extras', `extra-${String(slot).padStart(2, '0')}.opus`);
      if (this.rows('SELECT signature FROM extra_lines WHERE slot = ?', [slot])[0]?.signature !== signature || !fs.existsSync(output)) return { slot, text, signature, output };
    }
    return null;
  }
  async renderExtra(extra) {
    this.status = { ...this.status, state: 'generating', message: `Generating extra line ${extra.slot} of 40` }; this.emit();
    await this.render(extra.text, extra.output);
    this.db.run('INSERT OR REPLACE INTO extra_lines(slot, signature, created) VALUES (?, ?, ?)', [extra.slot, extra.signature, Date.now()]);
    await this.save();
  }
  pickExtraLine() {
    const settings = this.settings(); const ready = [];
    for (let slot = 1; slot <= 40; slot += 1) {
      const text = cleanText(settings.extraLines[slot - 1]); if (!text) continue;
      const signature = contentHash({ slot, text, voice: voiceFor(), bitrate: CLIP_BITRATE });
      const file = path.join(this.root, 'extras', `extra-${String(slot).padStart(2, '0')}.opus`);
      if (this.db && this.rows('SELECT signature FROM extra_lines WHERE slot = ?', [slot])[0]?.signature === signature && fs.existsSync(file)) ready.push({ slot, file });
    }
    if (!ready.length) return null;
    const signature = ready.map(item => item.slot).join(',');
    if (signature !== this.extraDeckSignature) { this.extraDeckSignature = signature; this.extraDeck = []; }
    if (!this.extraDeck.length) {
      this.extraDeck = [...ready].sort(() => Math.random() - 0.5);
      if (this.extraDeck.length > 1 && this.extraDeck[0].slot === this.lastExtraSlot) {
        [this.extraDeck[0], this.extraDeck[1]] = [this.extraDeck[1], this.extraDeck[0]];
      }
    }
    const selected = this.extraDeck.shift(); this.lastExtraSlot = selected.slot;
    return selected;
  }
  nextStationId() { const settings = this.settings(); if (!settings.stationName || !settings.djName) return null; for (let slot = 1; slot <= 50; slot += 1) { const text = stationIdText(settings.stationIds[slot - 1], settings); if (!text) continue; const signature = contentHash({ slot, text, voice: voiceFor(settings), bitrate: CLIP_BITRATE }); const existing = this.rows('SELECT signature FROM station_ids WHERE slot = ?', [slot])[0]; const output = path.join(this.root, 'ids', `id-${String(slot).padStart(2, '0')}.opus`); if (existing?.signature !== signature || !fs.existsSync(output)) return { slot, text, signature }; } return null; }
  activeStationIds() {
    const settings = this.settings();
    if (!settings.enabled) return [];
    const ids = [];
    for (let slot = 1; slot <= 50; slot += 1) {
      const text = stationIdText(settings.stationIds[slot - 1], settings);
      const file = path.join(this.root, 'ids', `id-${String(slot).padStart(2, '0')}.opus`);
      const signature = contentHash({ slot, text, voice: voiceFor(settings), bitrate: CLIP_BITRATE });
      const rendered = this.db ? this.rows('SELECT signature FROM station_ids WHERE slot = ?', [slot])[0] : null;
      if (text && rendered?.signature === signature && fs.existsSync(file)) ids.push({ slot, text, file, hasExtra: /\[xl\]/i.test(settings.stationIds[slot - 1]) });
    }
    return ids;
  }
  clipsFor(track, kind) {
    if (!this.enabled() || !track) return [];
    return this.availableClips(track, kind);
  }
  availableClips(track, kind) {
    if (!track) return [];
    const relative = sourceRelative(track);
    return [1, 2, 3].map(slot => ({ slot, file: path.join(this.root, clipRelativePath(track, kind, slot)) }))
      .filter(clip => fs.existsSync(clip.file));
  }
  canBuildBreak(endingTrack, incomingTrack) {
    return this.clipsFor(endingTrack, 'outro').length > 0 &&
      this.clipsFor(incomingTrack, 'intro').length > 0 && this.activeStationIds().length > 0;
  }
  shuffledStationId() {
    const active = this.activeStationIds();
    if (!active.length) return null;
    const signature = active.map(id => id.slot).join(',');
    if (signature !== this.stationIdDeckSignature) {
      this.stationIdDeckSignature = signature;
      this.stationIdDeck = [];
    }
    if (!this.stationIdDeck.length) {
      this.stationIdDeck = [...active].sort(() => Math.random() - 0.5);
      if (this.stationIdDeck.length > 1 && this.stationIdDeck[0].slot === this.lastPlayedStationIdSlot) {
        [this.stationIdDeck[0], this.stationIdDeck[1]] = [this.stationIdDeck[1], this.stationIdDeck[0]];
      }
    }
    const id = this.stationIdDeck.shift();
    this.lastPlayedStationIdSlot = id.slot;
    return id;
  }
  takeBreak(endingTrack, incomingTrack) {
    if (!this.canBuildBreak(endingTrack, incomingTrack)) return null;
    const outros = this.clipsFor(endingTrack, 'outro');
    const intros = this.clipsFor(incomingTrack, 'intro');
    const pick = clips => clips[Math.floor(Math.random() * clips.length)];
    const stationId = this.shuffledStationId();
    if (!stationId) return null;
    return { outro: pick(outros), stationId, extra: stationId.hasExtra ? this.pickExtraLine() : null, intro: pick(intros) };
  }
  async renderStationId(id) { const output = path.join(this.root, 'ids', `id-${String(id.slot).padStart(2, '0')}.opus`); this.status = { ...this.status, state: 'generating', completed: 0, total: 1, created: 0, reused: 0, message: `Generating station ID ${id.slot} of 50` }; this.emit(); await this.render(id.text, output); this.db.run('INSERT OR REPLACE INTO station_ids(slot, signature, created) VALUES (?, ?, ?)', [id.slot, id.signature, Date.now()]); await this.save(); this.status = { ...this.status, state: 'idle', completed: 1, created: 1, message: this.enabledMessage() }; this.emit(); }
  async render(text, output) {
    await fsp.mkdir(path.dirname(output), { recursive: true }); const wav = `${output}.${process.pid}.wav`; const part = `${output}.part`;
    try { await this.speak(text, wav); await new Promise((resolve, reject) => execFile(this.ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'libopus', '-b:a', CLIP_BITRATE, '-f', 'opus', part], error => error ? reject(error) : resolve())); await fsp.rename(part, output); }
    finally { await Promise.allSettled([fsp.rm(wav, { force: true }), fsp.rm(part, { force: true })]); }
  }
  async speak(text, wavPath) {
    if (!this.worker) this.createWorker(); await this.workerReady;
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => { const timeout = setTimeout(() => { this.requests.delete(id); reject(new Error('The DJ voice took too long to respond.')); }, 120000); this.requests.set(id, { resolve, reject, timeout }); this.worker.postMessage({ id, text, wavPath, voice: voiceFor(this.settings()) }); });
  }
  createWorker() {
    const modelDir = this.getModelDir();
    const worker = new Worker(path.join(__dirname, 'dj-renderer-worker.js'), { workerData: { modelDir }, stderr: true });
    this.worker = worker;
    let startupSettled = false;
    let startupError = '';
    let resolveStartup;
    let rejectStartup;
    const failStartup = error => {
      if (startupSettled) return;
      startupSettled = true;
      clearTimeout(startupTimeout);
      rejectStartup(new Error(startupError || error?.message || String(error) || 'Could not start the bundled DJ voice.'));
    };
    this.workerReady = new Promise((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });
    const startupTimeout = setTimeout(() => failStartup(new Error('The bundled DJ voice did not start in time.')), 120000);
    startupTimeout.unref?.();
    worker.stderr?.on('data', chunk => { startupError = `${startupError}${chunk}`.trim().slice(-4000); });
    worker.on('message', message => {
      if (message?.ready === true && !startupSettled) {
        startupSettled = true;
        clearTimeout(startupTimeout);
        resolveStartup();
        return;
      }
      if (message?.ready === false) { failStartup(new Error(message.error || 'Could not start the bundled DJ voice.')); return; }
      if (!message?.id) return;
      const request = this.requests.get(message.id); if (!request) return;
      this.requests.delete(message.id); clearTimeout(request.timeout);
      message.ok ? request.resolve() : request.reject(new Error(message.error || 'DJ voice generation failed.'));
    });
    const failWorker = error => {
      failStartup(error);
      for (const request of this.requests.values()) { clearTimeout(request.timeout); request.reject(error); }
      this.requests.clear();
      if (this.worker === worker) this.worker = null;
    };
    worker.on('error', failWorker);
    worker.on('exit', code => { if (code !== 0) failWorker(new Error(`The bundled DJ voice stopped during startup (exit ${code}).`)); });
  }
  stopAfterCurrentClip() { this.cancelAfterClip = true; }
  async close() { clearTimeout(this.timer); await this.worker?.terminate(); this.worker = null; await this.save(); this.db?.close(); this.db = null; }
}

module.exports = { DjClips, INTRO_TEMPLATES, OUTRO_TEMPLATES, clipRelativePath, templateText, LASTFM_MINIMUM, CLIP_BITRATE };
