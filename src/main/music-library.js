const { Worker } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');
class MusicLibrary {
  constructor({ dataDir, onStatus = () => {}, additionalMusicFolder = '' }) {
    this.dataDir = dataDir; this.onStatus = onStatus; this.pending = new Map(); this.sequence = 0;
    this.tracks = []; this.enabled = false; this.worker = null;
    this.additionalMusicFolder = additionalMusicFolder;
  }
  startWorker() {
    if (this.worker) return;
    this.worker = new Worker(path.join(__dirname, 'music-worker.js'), { workerData: { dataDir: this.dataDir, additionalMusicFolder: this.additionalMusicFolder } });
    this.worker.on('message', message => {
      if (message.event === 'status') { this.onStatus(message.value); return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.value);
    });
    const fail = error => {
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear(); this.worker = null;
      this.onStatus({ scanning: false, message: error.message });
    };
    this.worker.on('error', fail);
    this.worker.on('exit', code => { if (code) fail(new Error('Music index worker stopped. Reopen Music to retry.')); });
  }
  call(method, ...args) {
    this.startWorker();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence; this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }
  async enable({ scanOnEnable = false } = {}) {
    if (this.enabled) return this.initializing;
    this.enabled = true;
    this.initializing = this.call('all').then(tracks => { this.tracks = tracks; }).catch(error => { this.enabled = false; throw error; });
    await this.initializing;
    if (!this.enabled) return;
    if (scanOnEnable) void this.rescan().catch(error => this.onStatus({ message: error.message }));
  }
  disable() { this.enabled = false; }
  async setAdditionalMusicFolder(folder) {
    this.additionalMusicFolder = String(folder || '').trim();
    if (this.worker) {
      await this.call('set-roots', this.additionalMusicFolder);
      this.tracks = await this.call('all');
    }
  }
  async rescan() {
    const status = await this.call('scan'); this.tracks = await this.call('all'); this.onStatus(status); return status;
  }
  async resolve(id) {
    let track = this.tracks.find(t => t.id === id);
    if (!track) { this.tracks = await this.call('all'); track = this.tracks.find(t => t.id === id); }
    if (!track) throw new Error('That song is no longer indexed. Rescan Music.');
    const rootPath = track.library === 'additional' ? this.additionalMusicFolder : path.join(path.dirname(this.dataDir), 'Music');
    if (!rootPath) throw new Error('The additional music folder is no longer selected.');
    const root = await fs.realpath(rootPath);
    const file = await fs.realpath(path.join(root, track.relativePath));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.mp3$/i.test(file)) throw new Error('Song is outside Music.');
    return { ...track, path: file };
  }
  close() { this.disable(); this.worker?.terminate(); }
}
module.exports = { MusicLibrary };
