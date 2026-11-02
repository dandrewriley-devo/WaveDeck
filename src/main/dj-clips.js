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
  '[artist] there with “ [title].”'
];
const CLIP_BITRATE = '48k';
const VOICE = 'af_heart';
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

function templateText(template, track) {
  return cleanText(String(template)
    .replaceAll('[artist]', cleanText(track?.artist || track?.albumArtist || 'Unknown Artist'))
    .replaceAll('[title]', cleanText(track?.title || 'Untitled')));
}

class DjClips {
  constructor({ dataDir, getTracks, ffmpegPath, getModelDir, onStatus = () => {} }) {
    this.dataDir = dataDir;
    this.root = path.join(path.dirname(dataDir), 'DJ Clips');
    this.getTracks = getTracks;
    this.ffmpegPath = ffmpegPath;
    this.getModelDir = getModelDir;
    this.onStatus = onStatus;
    this.db = null; this.SQL = null; this.worker = null; this.workerReady = null; this.requests = new Map();
    this.running = false; this.timer = null; this.cancelAfterClip = false;
    this.status = { ready: false, state: 'idle', queued: 0, completed: 0, total: 0, created: 0, reused: 0, message: 'DJ clips are ready when you are.' };
  }
  async start() {
    if (this.db) return;
    await fsp.mkdir(this.root, { recursive: true });
    this.SQL = await initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) });
    const file = path.join(this.root, 'clips.sqlite');
    let bytes = null; try { bytes = await fsp.readFile(file); } catch {}
    this.db = bytes ? new this.SQL.Database(bytes) : new this.SQL.Database();
    this.db.run('PRAGMA journal_mode=WAL');
    this.db.run('CREATE TABLE IF NOT EXISTS clips (source_path TEXT NOT NULL, kind TEXT NOT NULL, slot INTEGER NOT NULL, output_path TEXT NOT NULL, signature TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(source_path, kind, slot))');
    this.db.run('CREATE TABLE IF NOT EXISTS jobs (track_id TEXT PRIMARY KEY, manual INTEGER NOT NULL DEFAULT 0, requested INTEGER NOT NULL)');
    await this.save();
    this.status = { ...this.status, ready: true, message: 'DJ clips are ready.' }; this.emit();
    void this.resume();
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
  qualifying(track) { return track?.library === 'portable' && track?.lastFm?.status === 'matched' && Number(track.lastFm?.popularity) >= LASTFM_MINIMUM; }
  async queueTrack(id, { manual = false } = {}) {
    await this.start(); const track = this.portableTrack(id); if (!track) throw new Error('That portable track is no longer available.');
    const current = this.rows('SELECT manual FROM jobs WHERE track_id = ?', [track.id])[0];
    this.db.run('INSERT OR REPLACE INTO jobs(track_id, manual, requested) VALUES (?, ?, ?)', [track.id, manual || Number(current?.manual) ? 1 : 0, Date.now()]);
    await this.save(); this.schedule(500); await this.refreshQueueStatus(); return this.getStatus();
  }
  async queueQualifyingTracks() {
    await this.start(); let queued = 0;
    for (const track of this.getTracks()) {
      if (!this.qualifying(track)) continue;
      this.db.run('INSERT OR IGNORE INTO jobs(track_id, manual, requested) VALUES (?, 0, ?)', [track.id, Date.now()]); queued += 1;
    }
    await this.save(); this.schedule(500); await this.refreshQueueStatus();
    return { ...this.getStatus(), queuedNow: queued };
  }
  async observeLastFm(track) { if (this.qualifying(track)) await this.queueTrack(track.id); }
  schedule(delay = 1500) { clearTimeout(this.timer); this.timer = setTimeout(() => void this.resume(), delay); this.timer.unref?.(); }
  async refreshQueueStatus() {
    if (!this.db) return;
    const queued = Number(this.rows('SELECT COUNT(*) AS count FROM jobs')[0]?.count) || 0;
    this.status = { ...this.status, queued }; this.emit();
  }
  async resume() {
    if (this.running) return;
    await this.start(); const jobs = this.rows('SELECT * FROM jobs ORDER BY requested ASC LIMIT 1');
    if (!jobs.length) { await this.refreshQueueStatus(); return; }
    const job = jobs[0]; const track = this.portableTrack(job.track_id);
    if (!track) { this.db.run('DELETE FROM jobs WHERE track_id = ?', [job.track_id]); await this.save(); return this.schedule(100); }
    if (!Number(job.manual) && !this.qualifying(track)) { this.db.run('DELETE FROM jobs WHERE track_id = ?', [track.id]); await this.save(); return this.schedule(100); }
    this.running = true; this.cancelAfterClip = false;
    try {
      const result = await this.renderTrack(track);
      if (!result.cancelled) { this.db.run('DELETE FROM jobs WHERE track_id = ?', [track.id]); await this.save(); }
    } catch (error) {
      this.status = { ...this.status, state: 'paused', message: `DJ clips paused: ${error.message}` }; this.emit();
      this.schedule(30_000);
    } finally { this.running = false; await this.refreshQueueStatus(); if (!this.cancelAfterClip) this.schedule(1500); }
  }
  getStatus() { return { ...this.status, templates: { intros: 3, outros: 3 }, root: this.root, bitrate: CLIP_BITRATE, voice: VOICE, threshold: LASTFM_MINIMUM }; }
  async trackState(id) {
    await this.start(); const track = this.portableTrack(id); if (!track) return { state: 'missing' };
    const queued = this.rows('SELECT manual FROM jobs WHERE track_id = ?', [track.id])[0];
    if (queued) return { state: this.running ? 'generating' : 'queued', manual: Number(queued.manual) === 1 };
    const count = Number(this.rows('SELECT COUNT(*) AS count FROM clips WHERE source_path = ?', [sourceRelative(track)])[0]?.count) || 0;
    return { state: count >= 6 ? 'ready' : 'missing', manual: false };
  }
  async renderTrack(track) {
    const relative = sourceRelative(track); const clips = [
      ...INTRO_TEMPLATES.map((template, index) => ({ kind: 'intro', slot: index + 1, text: templateText(template, track) })),
      ...OUTRO_TEMPLATES.map((template, index) => ({ kind: 'outro', slot: index + 1, text: templateText(template, track) }))
    ];
    const sourceFile = path.join(path.dirname(this.dataDir), 'Music', ...relative.split('/'));
    const sourceStat = await fsp.stat(sourceFile);
    this.status = { ...this.status, state: 'generating', completed: 0, total: clips.length, created: 0, reused: 0, message: `Preparing DJ clips for ${track.artist} — ${track.title}` }; this.emit();
    for (const clip of clips) {
      const outputRelative = clipRelativePath(track, clip.kind, clip.slot); const output = path.join(this.root, outputRelative);
      const signature = contentHash({ source: relative, bytes: sourceStat.size, modified: sourceStat.mtimeMs, kind: clip.kind, slot: clip.slot, text: clip.text, voice: VOICE, bitrate: CLIP_BITRATE });
      const existing = this.rows('SELECT signature, output_path FROM clips WHERE source_path = ? AND kind = ? AND slot = ?', [relative, clip.kind, clip.slot])[0];
      let reused = existing?.signature === signature && existing.output_path === outputRelative;
      if (reused) { try { reused = (await fsp.stat(output)).isFile(); } catch { reused = false; } }
      if (reused) this.status.reused += 1;
      else {
        this.status.message = `Generating ${clip.kind} ${clip.slot} for ${track.artist} — ${track.title}`; this.emit();
        await this.render(clip.text, output);
        this.db.run('INSERT OR REPLACE INTO clips(source_path, kind, slot, output_path, signature, created) VALUES (?, ?, ?, ?, ?, ?)', [relative, clip.kind, clip.slot, outputRelative, signature, Date.now()]);
        await this.save(); this.status.created += 1;
      }
      this.status.completed += 1; this.emit();
      if (this.cancelAfterClip) return { cancelled: true };
      await sleep(200);
    }
    this.status = { ...this.status, state: 'idle', message: `DJ clips ready for ${track.artist} — ${track.title}` }; this.emit(); return { cancelled: false };
  }
  async render(text, output) {
    await fsp.mkdir(path.dirname(output), { recursive: true }); const wav = `${output}.${process.pid}.wav`; const part = `${output}.part`;
    try { await this.speak(text, wav); await new Promise((resolve, reject) => execFile(this.ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', CLIP_BITRATE, '-f', 'opus', part], error => error ? reject(error) : resolve())); await fsp.rename(part, output); }
    finally { await Promise.allSettled([fsp.rm(wav, { force: true }), fsp.rm(part, { force: true })]); }
  }
  async speak(text, wavPath) {
    if (!this.worker) this.createWorker(); await this.workerReady;
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => { const timeout = setTimeout(() => { this.requests.delete(id); reject(new Error('The DJ voice took too long to respond.')); }, 120000); this.requests.set(id, { resolve, reject, timeout }); this.worker.postMessage({ id, text, wavPath }); });
  }
  createWorker() {
    const modelDir = this.getModelDir();
    this.worker = new Worker(path.join(__dirname, 'dj-renderer-worker.js'), { workerData: { modelDir } });
    this.workerReady = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The bundled DJ voice did not start in time.')), 120000);
      this.worker.once('message', message => { clearTimeout(timeout); if (message.ready) resolve(); else reject(new Error(message.error || 'Could not start the DJ voice.')); });
    });
    this.worker.on('message', message => { if (!message.id) return; const request = this.requests.get(message.id); if (!request) return; this.requests.delete(message.id); clearTimeout(request.timeout); message.ok ? request.resolve() : request.reject(new Error(message.error || 'DJ voice generation failed.')); });
    this.worker.on('error', error => { for (const request of this.requests.values()) { clearTimeout(request.timeout); request.reject(error); } this.requests.clear(); this.worker = null; });
  }
  stopAfterCurrentClip() { this.cancelAfterClip = true; }
  async close() { clearTimeout(this.timer); await this.worker?.terminate(); this.worker = null; await this.save(); this.db?.close(); this.db = null; }
}

module.exports = { DjClips, INTRO_TEMPLATES, OUTRO_TEMPLATES, clipRelativePath, templateText, LASTFM_MINIMUM, CLIP_BITRATE };
