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
const duplicateKey = track => [track.artist, track.title, track.albumArtist || track.artist, track.album, track.disc || 0, track.track || 0, Math.round((Number(track.duration) || 0) * 2) / 2].map(normalize).join('\n');
const hasCopySuffix = file => / \(\d+\)\.opus$/i.test(path.basename(file));
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
  constructor({ musicRoot, ffmpegExecutable, ffprobeExecutable, rescanLibrary = async () => {}, getProtectedPaths = async () => new Set(), onStatus = () => {}, spawnImpl = run, audioFingerprintImpl = audioFingerprint }) {
    this.musicRoot = path.resolve(musicRoot); this.ffmpegExecutable = ffmpegExecutable; this.ffprobeExecutable = ffprobeExecutable;
    this.rescanLibrary = rescanLibrary; this.getProtectedPaths = getProtectedPaths; this.onStatus = onStatus; this.spawnImpl = spawnImpl;
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
  async #writeMergedTags(file, track) {
    const temporary = `${file}.dedupe`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn', '-c:a', 'copy', '-metadata', `title=${cleanValue(track.title)}`, '-metadata', `artist=${cleanValue(track.artist)}`, '-metadata', `album=${cleanValue(track.album)}`, '-metadata', `album_artist=${cleanValue(track.albumArtist)}`, '-metadata', `track=${track.track || ''}`, '-metadata', `disc=${track.disc || ''}`, '-metadata', `date=${track.year || ''}`, '-metadata', `genre=${(track.genres || []).join('; ')}`, '-metadata', `RATING=${track.rating || ''}`, '-metadata', `FAVORITE=${track.favorite ? '1' : ''}`, '-metadata', `DO_NOT_PLAY=${track.doNotPlay ? '1' : ''}`, '-metadata', `AMP_TRACK_ID=${track.ampId || ''}`, '-f', 'opus', '-y', temporary];
    await this.spawnImpl(this.ffmpegExecutable, args);
    if (!await this.#isValidOpus(temporary)) throw new Error('WaveDeck could not validate the retained duplicate copy.');
    await fs.rename(temporary, file);
  }
  async #deduplicate(files) {
    if (!this.parseFile) ({ parseFile: this.parseFile } = await import('music-metadata'));
    const protectedPaths = await this.#protected(); const groups = new Map();
    for (const file of files) {
      if (protectedPaths.has(path.resolve(file))) continue;
      try {
        const relative = path.relative(this.musicRoot, file);
        const metadata = await this.parseFile(file, { skipCovers: true, duration: true });
        const track = extractTrack(metadata, relative, 'portable'); const key = duplicateKey(track);
        if (!key.replace(/\n/g, '')) continue;
        const stat = await fs.stat(file);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ file, stat, track });
      } catch {}
    }
    let removed = 0;
    for (const candidates of groups.values()) {
      if (candidates.length < 2) continue;
      const fingerprints = new Map();
      for (const candidate of candidates) {
        try {
          const fingerprint = await this.audioFingerprintImpl(this.ffmpegExecutable, candidate.file);
          if (!fingerprints.has(fingerprint)) fingerprints.set(fingerprint, []);
          fingerprints.get(fingerprint).push(candidate);
        } catch {}
      }
      for (const matches of fingerprints.values()) {
        if (matches.length < 2 || matches.some(candidate => protectedPaths.has(path.resolve(candidate.file)))) continue;
        matches.sort((left, right) => Number(hasCopySuffix(left.file)) - Number(hasCopySuffix(right.file)) || left.stat.mtimeMs - right.stat.mtimeMs || left.file.localeCompare(right.file));
        const keeper = matches[0];
        const merged = { ...keeper.track, rating: Math.max(...matches.map(candidate => Number(candidate.track.rating) || 0)), favorite: matches.some(candidate => candidate.track.favorite), doNotPlay: matches.some(candidate => candidate.track.doNotPlay) };
        try {
          if (merged.rating !== keeper.track.rating || merged.favorite !== keeper.track.favorite || merged.doNotPlay !== keeper.track.doNotPlay) await this.#writeMergedTags(keeper.file, merged);
          for (const duplicate of matches.slice(1)) { await fs.unlink(duplicate.file); removed += 1; }
          this.watchIgnoreUntil = Date.now() + 6000;
        } catch (error) { this.#emit({ errors: this.status.errors + 1, message: `Could not remove duplicate ${path.basename(keeper.file)}: ${cleanValue(error.message, 280)}` }); }
      }
    }
    return removed;
  }
  async start() {
    if (this.running) return this.running; if (!this.enabled) return this.getStatus();
    this.running = (async () => { let changed = false; try { await fs.mkdir(this.musicRoot, { recursive: true }); const { sources, opus, sidecars } = await this.#collect(this.musicRoot); const logicalTrack = file => file.slice(0, -path.extname(file).length); const total = new Set([...sources, ...opus].map(logicalTrack)).size; const alreadyConverted = new Set(opus.map(logicalTrack)).size; this.#emit(this.#status({ optimizing: true, total, converted: alreadyConverted, pending: sources.length })); for (let index = 0; index < sources.length; index += 1) { if (!this.enabled) break; const source = sources[index]; this.#emit({ current: path.relative(this.musicRoot, source), pending: sources.length - index }); try { const result = await this.#convert(source); changed ||= result.converted || !result.retained; this.#emit({ converted: this.status.converted + 1, pending: sources.length - index - 1, retained: this.status.retained + (result.retained ? 1 : 0) }); } catch (error) { this.#emit({ errors: this.status.errors + 1, pending: sources.length - index - 1, message: `Could not optimize ${path.basename(source)}: ${cleanValue(error.message, 280)}` }); } } const cleaned = await this.#cleanSidecars(sidecars); changed ||= cleaned > 0; if (this.deduplicationPending) { const current = await this.#collect(this.musicRoot); const duplicates = await this.#deduplicate(current.opus); this.deduplicationPending = false; changed ||= duplicates > 0; this.#emit({ cleaned: this.status.cleaned + cleaned + duplicates, pending: 0, current: '' }); } else this.#emit({ cleaned: this.status.cleaned + cleaned, pending: 0, current: '' }); if (changed) await this.rescanLibrary(); } finally { this.#emit({ optimizing: false, current: '', pending: 0 }); this.running = null; } return this.getStatus(); })();
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
