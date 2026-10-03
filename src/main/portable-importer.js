const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { extractTrack, normalize } = require('./music-tags');

const IMPORT_EXTENSIONS = new Set(['.mp3', '.opus', '.flac', '.m4a', '.aac', '.wav', '.wma', '.ogg']);
const OPUS_BYTES_PER_SECOND = 12000;
const clean = value => String(value ?? '').replace(/[\u0000\r\n]/g, ' ').trim().slice(0, 500);
const displayBytes = bytes => {
  const value = Math.max(0, Number(bytes) || 0); const units = ['B', 'KB', 'MB', 'GB', 'TB']; let size = value; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
};
const trackKey = track => [track.artist, track.title, track.albumArtist || track.artist, track.album, track.disc || 0, track.track || 0, Math.round((Number(track.duration) || 0) * 2) / 2].map(normalize).join('\n');
function run(executable, args) {
  return new Promise((resolve, reject) => {
    let stderr = ''; let stdout = ''; let child;
    try { child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (error) { reject(error); return; }
    child.stdout?.on('data', value => { stdout = `${stdout}${value}`.slice(-4096); });
    child.stderr?.on('data', value => { stderr = `${stderr}${value}`.slice(-4096); });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 && !signal ? resolve(stdout) : reject(new Error(clean(stderr, 900) || `conversion stopped with ${signal || `code ${code}`}`)));
  });
}
async function exists(file) { try { return (await fs.stat(file)).isFile(); } catch { return false; } }

class PortableImporter {
  constructor({ musicRoot, ffmpegExecutable, ffprobeExecutable, getAdditionalFolder, getPortableTracks, onStatus = () => {}, onComplete = async () => {} }) {
    this.musicRoot = musicRoot; this.ffmpegExecutable = ffmpegExecutable; this.ffprobeExecutable = ffprobeExecutable;
    this.getAdditionalFolder = getAdditionalFolder; this.getPortableTracks = getPortableTracks; this.onStatus = onStatus; this.onComplete = onComplete;
    this.previewValue = null; this.running = null; this.parseFile = null; this.status = { state: 'idle', eligible: 0, total: 0, completed: 0, estimatedBytes: 0, availableBytes: 0, etaSeconds: null, message: '' };
  }
  #emit(value = {}) { this.status = { ...this.status, ...value }; this.onStatus({ ...this.status }); return this.status; }
  getStatus() { return { ...this.status }; }
  async #sources(folder, out = []) {
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch (error) { throw new Error(`WaveDeck cannot read the Additional Music Folder: ${error.message}`); }
    for (const entry of entries) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await this.#sources(file, out);
      else if (entry.isFile() && IMPORT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(file);
    }
    return out;
  }
  async #metadata(file, relative) {
    if (!this.parseFile) ({ parseFile: this.parseFile } = await import('music-metadata'));
    return extractTrack(await this.parseFile(file, { skipCovers: true, duration: true }), relative, 'import');
  }
  async #space() {
    const info = await fs.statfs(this.musicRoot); const blockSize = Number(info.bsize || info.frsize || 4096);
    return Math.max(0, Number(info.bavail || 0) * blockSize);
  }
  async preview() {
    if (this.running) return this.getStatus();
    const folder = String(this.getAdditionalFolder() || '').trim();
    if (!folder) return this.#emit({ state: 'waiting', eligible: 0, total: 0, completed: 0, estimatedBytes: 0, message: 'Choose an Additional Music Folder to see import options.' });
    this.#emit({ state: 'checking', message: 'Checking music available to import…' });
    const known = new Set((this.getPortableTracks() || []).map(trackKey));
    const files = await this.#sources(folder); const candidates = [];
    for (const file of files) {
      try {
        const relative = path.relative(folder, file); const track = await this.#metadata(file, relative); const key = trackKey(track);
        if (!key.replace(/\n/g, '')) continue;
        if (known.has(key)) continue;
        known.add(key); candidates.push({ file, relative, track });
      } catch {}
    }
    const estimatedBytes = candidates.reduce((sum, item) => sum + Math.max(1, Number(item.track.duration) || 240) * OPUS_BYTES_PER_SECOND, 0);
    const availableBytes = await this.#space();
    this.previewValue = { folder, candidates, estimatedBytes, availableBytes };
    return this.#emit({ state: 'ready', eligible: candidates.length, total: candidates.length, completed: 0, estimatedBytes, availableBytes, etaSeconds: null, message: candidates.length ? '' : 'Everything supported in this Additional Music Folder is already portable.' });
  }
  async #validOpus(file) {
    if (!await exists(file)) return false;
    try { const codec = await run(this.ffprobeExecutable, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', file]); return String(codec || '').trim().split(/\s+/).includes('opus') && (await fs.stat(file)).size > 1024; } catch { return false; }
  }
  async #convert(item) {
    const safeRelative = item.relative.split(path.sep).join('/').replace(/^\/+/, '').replace(/\.[^.\/]+$/, '') + '.opus';
    const destination = path.join(this.musicRoot, 'Imported', safeRelative); const relative = path.relative(this.musicRoot, destination);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe import path.');
    if (await this.#validOpus(destination)) return;
    await fs.mkdir(path.dirname(destination), { recursive: true }); const partial = `${destination}.part`;
    try { await fs.unlink(partial); } catch {}
    await run(this.ffmpegExecutable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', item.file, '-map', '0:a:0', '-map_metadata', '-1', '-vn', '-sn', '-dn', '-c:a', 'libopus', '-application', 'audio', '-b:a', '96k', '-vbr', 'on', '-compression_level', '10', '-metadata', `title=${clean(item.track.title)}`, '-metadata', `artist=${clean(item.track.artist)}`, '-metadata', `album=${clean(item.track.album)}`, '-metadata', `album_artist=${clean(item.track.albumArtist)}`, '-metadata', `track=${item.track.track || ''}`, '-metadata', `disc=${item.track.disc || ''}`, '-metadata', `date=${item.track.year || ''}`, '-metadata', `genre=${(item.track.genres || []).join('; ')}`, '-metadata', `RATING=${item.track.rating || ''}`, '-metadata', `FAVORITE=${item.track.favorite ? '1' : ''}`, '-metadata', `DO_NOT_PLAY=${item.track.doNotPlay ? '1' : ''}`, '-f', 'opus', '-y', partial]);
    if (!await this.#validOpus(partial)) throw new Error('WaveDeck could not validate the new Opus file.');
    await fs.rename(partial, destination);
  }
  async start() {
    if (this.running) return this.getStatus();
    if (!this.previewValue) await this.preview();
    if (!this.previewValue?.candidates?.length) return this.getStatus();
    if (this.previewValue.estimatedBytes > this.previewValue.availableBytes * 0.95) throw new Error(`Not enough portable-drive space. About ${displayBytes(this.previewValue.estimatedBytes)} is needed, with ${displayBytes(this.previewValue.availableBytes)} available.`);
    const candidates = this.previewValue.candidates; const started = Date.now();
    this.running = (async () => {
      this.#emit({ state: 'importing', total: candidates.length, completed: 0, etaSeconds: null, message: 'Converting and importing…' });
      let completed = 0; let errors = 0;
      for (const item of candidates) {
        try { await this.#convert(item); } catch { errors += 1; }
        completed += 1; const elapsed = Math.max(1, (Date.now() - started) / 1000);
        this.#emit({ completed, etaSeconds: completed >= 3 ? Math.round((elapsed / completed) * (candidates.length - completed)) : null, message: errors ? `${errors} track${errors === 1 ? '' : 's'} need attention.` : 'Converting and importing…' });
      }
      await this.onComplete(); this.previewValue = null;
      return this.#emit({ state: 'complete', eligible: 0, total: candidates.length, completed, etaSeconds: 0, message: errors ? `Import finished with ${errors} track${errors === 1 ? '' : 's'} needing attention.` : 'Import complete.' });
    })().finally(() => { this.running = null; });
    return this.getStatus();
  }
}
module.exports = { PortableImporter, IMPORT_EXTENSIONS, OPUS_BYTES_PER_SECOND, trackKey, displayBytes };
