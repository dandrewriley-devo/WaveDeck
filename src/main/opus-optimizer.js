const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { customTags, extractTrack, normalize } = require('./music-tags');

const OPUS_BITRATE = '96k';
const SOURCE_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.wma', '.ogg']);
const SIDECAR_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff',
  '.lrc', '.lyrics', '.srt', '.vtt', '.ass', '.ssa', '.txt', '.nfo', '.cue', '.m3u', '.m3u8'
]);
const cleanValue = (value, max = 600) => String(value ?? '').replace(/[\u0000\r\n]/g, ' ').trim().slice(0, max);
const outputFor = source => `${source.slice(0, -path.extname(source).length)}.opus`;
function isPortablePath(root, candidate) { const relative = path.relative(root, candidate); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); }
function stableAmpId(root, source) {
  const relative = path.relative(root, source).split(path.sep).join('/').replace(/\.[^.\/]+$/, '');
  return `wdop_${crypto.createHash('sha256').update(relative).digest('hex').slice(0, 32)}`;
}
function run(executable, args) {
  return new Promise((resolve, reject) => {
    let stderr = ''; let stdout = ''; let child;
    try { child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (error) { reject(error); return; }
    child.stdout?.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-4096); });
    child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4096); });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve(stdout) : reject(new Error(cleanValue(stderr, 1200) || `process exited with ${signal || `code ${code}`}`)));
  });
}
async function fileExists(filePath) { try { return (await fs.stat(filePath)).isFile(); } catch { return false; } }
const hasCopySuffix = file => / \(\d+\)\.opus$/i.test(path.basename(file));
const relativePortablePath = (root, file) => path.relative(root, file).split(path.sep).join('/');
const diagnosticTrack = track => ({ artist: cleanValue(track?.artist, 160), albumArtist: cleanValue(track?.albumArtist, 160), album: cleanValue(track?.album, 160), title: cleanValue(track?.title, 160), disc: Number(track?.disc) || 0, track: Number(track?.track) || 0, duration: Math.round((Number(track?.duration) || 0) * 10) / 10, rating: Number(track?.rating) || 0, favorite: track?.favorite === true, doNotPlay: track?.doNotPlay === true });
const copyNameKey = (root, file) => normalize(relativePortablePath(root, file).replace(/\.opus$/i, '').replace(/ \(\d+\)$/i, ''));
function audioFingerprint(executable, file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256'); let stderr = ''; let child;
    try { child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (error) { reject(error); return; }
    child.stdout.on('data', chunk => hash.update(chunk));
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4096); });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve(hash.digest('hex')) : reject(new Error(cleanValue(stderr, 1200) || `fingerprint stopped with ${signal || `code ${code}`}`)));
  });
}

class OpusOptimizer {
  constructor({ musicRoot, ffmpegExecutable, ffprobeExecutable, diagnosticsPath = '', rescanLibrary = async () => {}, getProtectedPaths = async () => new Set(), onStatus = () => {}, spawnImpl = run, audioFingerprintImpl = audioFingerprint }) {
    this.musicRoot = path.resolve(musicRoot); this.ffmpegExecutable = ffmpegExecutable; this.ffprobeExecutable = ffprobeExecutable;
    this.rescanLibrary = rescanLibrary; this.getProtectedPaths = getProtectedPaths; this.onStatus = onStatus; this.spawnImpl = spawnImpl;
    this.diagnosticsPath = diagnosticsPath ? path.resolve(diagnosticsPath) : ''; this.fingerprintCache = new Map(); this.diagnosticsLoaded = false; this.recentDedupRuns = [];
    this.running = null; this.watchers = []; this.watchTimer = null; this.periodicTimer = null; this.watchIgnoreUntil = 0; this.parseFile = null; this.enabled = true; this.deduplicationPending = true; this.audioFingerprintImpl = audioFingerprintImpl; this.status = this.#status();
  }
  #status(overrides = {}) { return { optimizing: false, current: '', total: 0, pending: 0, converted: 0, retained: 0, cleaned: 0, errors: 0, message: '', ...overrides }; }
  #emit(overrides = {}) { this.status = { ...this.status, ...overrides }; this.onStatus({ ...this.status }); }
  getStatus() { return { ...this.status }; }
  isRunning() { return Boolean(this.running); }
  setEnabled(enabled) { this.enabled = enabled === true; }
  async #protected() { const paths = await this.getProtectedPaths(); return new Set([...(paths || [])].map(value => path.resolve(String(value))).filter(Boolean)); }
  async #isProtected(source) { return (await this.#protected()).has(path.resolve(source)); }
  async #collect(directory, result = { sources: [], opus: [], sidecars: [] }) {
    let entries; try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return result; }
    for (const entry of entries) { const file = path.join(directory, entry.name); if (entry.isDirectory()) { await this.#collect(file, result); continue; } if (!entry.isFile()) continue; const extension = path.extname(entry.name).toLowerCase(); if (SOURCE_EXTENSIONS.has(extension)) result.sources.push(file); else if (extension === '.opus') result.opus.push(file); else if (SIDECAR_EXTENSIONS.has(extension)) result.sidecars.push(file); }
    return result;
  }
  async #isValidOpus(filePath) {
    if (!await fileExists(filePath)) return false;
    try { const codec = await this.spawnImpl(this.ffprobeExecutable, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', filePath]); const stat = await fs.stat(filePath); return String(codec || '').trim().split(/\s+/).includes('opus') && stat.size > 1024; } catch { return false; }
  }
  async #metadataArguments(source) {
    if (!this.parseFile) ({ parseFile: this.parseFile } = await import('music-metadata'));
    const metadata = await this.parseFile(source, { skipCovers: true, duration: false }); const common = metadata.common || {}; const custom = customTags(metadata); const args = [];
    const append = (key, value) => { const clean = cleanValue(value); if (clean) args.push('-metadata', `${key}=${clean}`); };
    append('title', common.title || path.basename(source, path.extname(source))); append('artist', common.artist); append('album', common.album); append('album_artist', common.albumartist); append('track', common.track?.no); append('disc', common.disk?.no); append('date', common.year || common.originalyear); append('genre', Array.isArray(common.genre) ? common.genre.join('; ') : common.genre); append('RATING', custom.RATING); append('FAVORITE', custom.FAVORITE); append('DO_NOT_PLAY', custom.DO_NOT_PLAY); append('AMP_TRACK_ID', custom.AMP_TRACK_ID || stableAmpId(this.musicRoot, source));
    return args;
  }
  async #removeSourceIfSafe(source, output) { if (!await this.#isValidOpus(output) || !this.enabled || await this.#isProtected(source)) return false; try { await fs.unlink(source); this.watchIgnoreUntil = Date.now() + 6000; return true; } catch { return false; } }
  async #convert(source) {
    const output = outputFor(source); const partial = `${output}.part`;
    if (await this.#isValidOpus(output)) return { converted: false, retained: !await this.#removeSourceIfSafe(source, output) };
    if (await this.#isValidOpus(partial)) { await fs.rename(partial, output); return { converted: false, retained: !await this.#removeSourceIfSafe(source, output) }; }
    try { await fs.unlink(partial); } catch {}
    const metadataArgs = await this.#metadataArguments(source);
    await this.spawnImpl(this.ffmpegExecutable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn', '-c:a', 'libopus', '-application', 'audio', '-b:a', OPUS_BITRATE, '-vbr', 'on', '-compression_level', '10', ...metadataArgs, '-f', 'opus', '-y', partial]);
    if (!await this.#isValidOpus(partial)) throw new Error('WaveDeck could not validate the new Opus file.');
    await fs.rename(partial, output); const retained = !await this.#removeSourceIfSafe(source, output); this.watchIgnoreUntil = Date.now() + 6000; return { converted: true, retained };
  }
  async #cleanSidecars(files) { let cleaned = 0; for (const file of files) { if (!isPortablePath(this.musicRoot, file)) continue; try { await fs.unlink(file); cleaned += 1; } catch {} } return cleaned; }
  async #loadDedupDiagnostics() {
    if (this.diagnosticsLoaded) return; this.diagnosticsLoaded = true;
    if (!this.diagnosticsPath) return;
    try {
      const saved = JSON.parse(await fs.readFile(this.diagnosticsPath, 'utf8'));
      for (const [relative, entry] of Object.entries(saved?.fingerprintCache || {})) {
        if (typeof entry?.fingerprint === 'string' && Number.isFinite(entry.size) && Number.isFinite(entry.mtimeMs)) this.fingerprintCache.set(relative, entry);
      }
      this.recentDedupRuns = Array.isArray(saved?.recentRuns) ? saved.recentRuns.slice(0, 8) : [];
    } catch {}
  }
  async #saveDedupDiagnostics(run, { checkpoint = false } = {}) {
    if (!this.diagnosticsPath) return;
    const summary = {
      startedAt: run.startedAt, completedAt: run.completedAt || null, state: run.state,
      totalFiles: run.totalFiles, cacheHits: run.cacheHits, fingerprinted: run.fingerprinted,
      exactGroups: run.exactGroups, removed: run.removed, deferred: run.deferred,
      audioDifferent: run.audioDifferent, errors: run.errors.length, elapsedMs: Date.now() - run.startedMs
    };
    if (!checkpoint && run.completedAt) this.recentDedupRuns = [summary, ...this.recentDedupRuns].slice(0, 8);
    const cache = Object.fromEntries(this.fingerprintCache);
    const report = {
      version: 1, generatedAt: new Date().toISOString(), diagnostics: 'WaveDeck Opus automatic duplicate cleanup report. Matching decoded-audio fingerprints are safe duplicate evidence; all file paths are relative to portable Music.',
      lastRun: { ...summary, groups: run.groups.slice(0, 600), errors: run.errors.slice(0, 120), truncatedGroups: Math.max(0, run.groups.length - 600) },
      recentRuns: this.recentDedupRuns, fingerprintCache: cache
    };
    const temporary = `${this.diagnosticsPath}.tmp`;
    try { await fs.mkdir(path.dirname(this.diagnosticsPath), { recursive: true }); await fs.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`); await fs.rename(temporary, this.diagnosticsPath); } catch {}
  }
  async #trackForDiagnostic(file) {
    try {
      if (!this.parseFile) ({ parseFile: this.parseFile } = await import('music-metadata'));
      const metadata = await this.parseFile(file, { skipCovers: true, duration: true });
      return extractTrack(metadata, relativePortablePath(this.musicRoot, file), 'portable');
    } catch { return null; }
  }
  async #fingerprint(file, stat, run) {
    const relative = relativePortablePath(this.musicRoot, file); const saved = this.fingerprintCache.get(relative);
    if (saved && saved.size === stat.size && saved.mtimeMs === stat.mtimeMs && typeof saved.fingerprint === 'string') { run.cacheHits += 1; return saved.fingerprint; }
    try {
      const fingerprint = await this.audioFingerprintImpl(this.ffmpegExecutable, file);
      this.fingerprintCache.set(relative, { size: stat.size, mtimeMs: stat.mtimeMs, fingerprint }); run.fingerprinted += 1;
      if (run.fingerprinted % 1000 === 0) await this.#saveDedupDiagnostics(run, { checkpoint: true });
      return fingerprint;
    } catch (error) {
      run.errors.push({ file: relative, stage: 'audio fingerprint', error: cleanValue(error.message, 360) }); return '';
    }
  }
  async #writeMergedTags(file, track) {
    const temporary = `${file}.dedupe`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn', '-c:a', 'copy', '-metadata', `title=${cleanValue(track.title)}`, '-metadata', `artist=${cleanValue(track.artist)}`, '-metadata', `album=${cleanValue(track.album)}`, '-metadata', `album_artist=${cleanValue(track.albumArtist)}`, '-metadata', `track=${track.track || ''}`, '-metadata', `disc=${track.disc || ''}`, '-metadata', `date=${track.year || ''}`, '-metadata', `genre=${(track.genres || []).join('; ')}`, '-metadata', `RATING=${track.rating || ''}`, '-metadata', `FAVORITE=${track.favorite ? '1' : ''}`, '-metadata', `DO_NOT_PLAY=${track.doNotPlay ? '1' : ''}`, '-metadata', `AMP_TRACK_ID=${track.ampId || ''}`, '-f', 'opus', '-y', temporary];
    await this.spawnImpl(this.ffmpegExecutable, args);
    if (!await this.#isValidOpus(temporary)) throw new Error('WaveDeck could not validate the retained duplicate copy.');
    await fs.rename(temporary, file);
  }
  async #deduplicate(files) {
    await this.#loadDedupDiagnostics();
    const run = { startedAt: new Date().toISOString(), startedMs: Date.now(), completedAt: null, state: 'running', totalFiles: files.length, cacheHits: 0, fingerprinted: 0, exactGroups: 0, removed: 0, deferred: 0, audioDifferent: 0, errors: [], groups: [] };
    await this.#saveDedupDiagnostics(run, { checkpoint: true });
    const protectedPaths = await this.#protected(); const byFingerprint = new Map(); const byCopyName = new Map(); const knownPaths = new Set();
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]; const relative = relativePortablePath(this.musicRoot, file); knownPaths.add(relative);
      this.#emit({ current: `Checking duplicate audio ${index + 1} of ${files.length}`, pending: files.length - index - 1 });
      try {
        const stat = await fs.stat(file); const fingerprint = await this.#fingerprint(file, stat, run); if (!fingerprint) continue;
        const candidate = { file, relative, stat, fingerprint, protected: protectedPaths.has(path.resolve(file)), track: null };
        if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, []); byFingerprint.get(fingerprint).push(candidate);
        const nameKey = copyNameKey(this.musicRoot, file); if (!byCopyName.has(nameKey)) byCopyName.set(nameKey, []); byCopyName.get(nameKey).push(candidate);
      } catch (error) { run.errors.push({ file: relative, stage: 'file inspection', error: cleanValue(error.message, 360) }); }
    }
    for (const relative of this.fingerprintCache.keys()) if (!knownPaths.has(relative)) this.fingerprintCache.delete(relative);
    for (const candidates of byFingerprint.values()) {
      if (candidates.length < 2) continue; run.exactGroups += 1;
      for (const candidate of candidates) candidate.track = await this.#trackForDiagnostic(candidate.file);
      candidates.sort((left, right) => Number(hasCopySuffix(left.file)) - Number(hasCopySuffix(right.file)) || left.stat.mtimeMs - right.stat.mtimeMs || left.file.localeCompare(right.file));
      const keeper = candidates[0]; const group = { type: 'exact-audio', fingerprint: keeper.fingerprint.slice(0, 16), files: candidates.map(candidate => ({ file: candidate.relative, protected: candidate.protected, tags: diagnosticTrack(candidate.track) })) };
      if (candidates.some(candidate => candidate.protected)) { run.deferred += candidates.length - 1; group.action = 'deferred-currently-playing'; run.groups.push(group); continue; }
      const tracks = candidates.map(candidate => candidate.track).filter(Boolean); const merged = { ...(keeper.track || {}), rating: Math.max(0, ...tracks.map(track => Number(track.rating) || 0)), favorite: tracks.some(track => track.favorite), doNotPlay: tracks.some(track => track.doNotPlay) };
      try {
        if (keeper.track && (merged.rating !== keeper.track.rating || merged.favorite !== keeper.track.favorite || merged.doNotPlay !== keeper.track.doNotPlay)) {
          await this.#writeMergedTags(keeper.file, merged); keeper.track = merged; const stat = await fs.stat(keeper.file); this.fingerprintCache.set(keeper.relative, { size: stat.size, mtimeMs: stat.mtimeMs, fingerprint: keeper.fingerprint }); group.merged = { rating: merged.rating, favorite: merged.favorite, doNotPlay: merged.doNotPlay };
        }
        const removed = [];
        for (const duplicate of candidates.slice(1)) { await fs.unlink(duplicate.file); this.fingerprintCache.delete(duplicate.relative); removed.push(duplicate.relative); run.removed += 1; }
        this.watchIgnoreUntil = Date.now() + 6000; group.action = 'removed'; group.keeper = keeper.relative; group.removed = removed; run.groups.push(group);
      } catch (error) { group.action = 'remove-failed'; group.error = cleanValue(error.message, 360); run.errors.push({ file: keeper.relative, stage: 'duplicate removal', error: group.error }); run.groups.push(group); this.#emit({ errors: this.status.errors + 1, message: `Could not remove duplicate ${path.basename(keeper.file)}: ${group.error}` }); }
    }
    for (const copies of byCopyName.values()) {
      if (copies.length < 2 || new Set(copies.map(candidate => candidate.fingerprint)).size < 2) continue;
      run.audioDifferent += 1;
      for (const candidate of copies) candidate.track ||= await this.#trackForDiagnostic(candidate.file);
      run.groups.push({ type: 'same-copy-name-different-audio', action: 'kept-audio-different', files: copies.map(candidate => ({ file: candidate.relative, fingerprint: candidate.fingerprint.slice(0, 16), tags: diagnosticTrack(candidate.track) })) });
    }
    run.completedAt = new Date().toISOString(); run.state = run.errors.length ? 'completed-with-errors' : 'completed'; await this.#saveDedupDiagnostics(run);
    this.deduplicationPending = run.errors.length > 0 || run.deferred > 0;
    return run.removed;
  }
  async start() {
    if (this.running) return this.running; if (!this.enabled) return this.getStatus();
    this.running = (async () => { let changed = false; try { await fs.mkdir(this.musicRoot, { recursive: true }); const { sources, opus, sidecars } = await this.#collect(this.musicRoot); const logicalTrack = file => file.slice(0, -path.extname(file).length); const total = new Set([...sources, ...opus].map(logicalTrack)).size; const alreadyConverted = new Set(opus.map(logicalTrack)).size; this.#emit(this.#status({ optimizing: true, total, converted: alreadyConverted, pending: sources.length })); for (let index = 0; index < sources.length; index += 1) { if (!this.enabled) break; const source = sources[index]; this.#emit({ current: path.relative(this.musicRoot, source), pending: sources.length - index }); try { const result = await this.#convert(source); changed ||= result.converted || !result.retained; this.#emit({ converted: this.status.converted + 1, pending: sources.length - index - 1, retained: this.status.retained + (result.retained ? 1 : 0) }); } catch (error) { this.#emit({ errors: this.status.errors + 1, pending: sources.length - index - 1, message: `Could not optimize ${path.basename(source)}: ${cleanValue(error.message, 280)}` }); } } const cleaned = await this.#cleanSidecars(sidecars); changed ||= cleaned > 0; if (this.deduplicationPending) { const current = await this.#collect(this.musicRoot); const duplicates = await this.#deduplicate(current.opus); changed ||= duplicates > 0; this.#emit({ cleaned: this.status.cleaned + cleaned + duplicates, pending: 0, current: '' }); } else this.#emit({ cleaned: this.status.cleaned + cleaned, pending: 0, current: '' }); if (changed) await this.rescanLibrary(); } finally { this.#emit({ optimizing: false, current: '', pending: 0 }); this.running = null; } return this.getStatus(); })();
    return this.running;
  }
  watch(onChange) {
    if (this.watchers.length) return; const schedule = () => { if (Date.now() < this.watchIgnoreUntil) return; this.deduplicationPending = true; clearTimeout(this.watchTimer); this.watchTimer = setTimeout(() => { this.watchTimer = null; if (!this.isRunning() && Date.now() >= this.watchIgnoreUntil) void onChange(); }, 3000); };
    try { this.watchers.push(fsSync.watch(this.musicRoot, { recursive: true }, (_event, name) => { if (!name || /\.(mp3|opus|flac|m4a|aac|wav|wma|ogg|jpg|jpeg|png|gif|webp|bmp|tif|tiff|lrc|lyrics|txt)$/i.test(String(name))) schedule(); })); } catch { try { this.watchers.push(fsSync.watch(this.musicRoot, schedule)); } catch {} }
    this.periodicTimer = setInterval(() => { void onChange(); }, 10 * 60 * 1000); this.periodicTimer.unref?.();
  }
  close() { clearTimeout(this.watchTimer); clearInterval(this.periodicTimer); this.periodicTimer = null; for (const watcher of this.watchers.splice(0)) try { watcher.close(); } catch {} }
}
module.exports = { OpusOptimizer, OPUS_BITRATE, SOURCE_EXTENSIONS, SIDECAR_EXTENSIONS, outputFor, stableAmpId };
