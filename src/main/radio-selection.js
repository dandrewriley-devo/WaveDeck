const path = require('path');
const { Worker } = require('worker_threads');

class RadioSelection {
  constructor({ dataDir, onDecision = () => {}, getFamiliarity = () => 'balanced', getTuning = () => ({}) }) {
    this.dataDir = dataDir;
    this.onDecision = onDecision;
    this.getFamiliarity = getFamiliarity;
    this.getTuning = getTuning;
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
    this.tracks = null;
    this.revision = -1;
    this.lastDecision = null;
    this.lastSelectionMs = null;
    this.awayFromSeed = false;
    this.closed = false;
    this.cancelBuffer = new SharedArrayBuffer(4);
    this.cancellation = new Int32Array(this.cancelBuffer);
  }

  start() {
    if (this.worker) return;
    if (this.closed) throw new Error('Local Radio is closing.');
    const worker = new Worker(path.join(__dirname, 'radio-selection-worker.js'), { workerData: { dataDir: this.dataDir, cancelBuffer: this.cancelBuffer } });
    this.worker = worker;
    worker.on('message', message => {
      if (message.event === 'decision') {
        this.lastDecision = message.value;
        try { this.onDecision(message.value); } catch {}
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else {
        this.lastDecision = message.decision;
        this.awayFromSeed = message.awayFromSeed;
        if (message.selectionMs !== null) this.lastSelectionMs = message.selectionMs;
        pending.resolve(message.value);
      }
    });
    const fail = error => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.tracks = null;
      this.revision = -1;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', code => fail(new Error(`Local Radio worker stopped (${code}).`)));
  }

  call(method, ...args) {
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, method, args }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }

  setTracks(tracks, revision = 0) {
    if (this.tracks === tracks && this.revision === revision && this.worker) return Promise.resolve();
    this.tracks = tracks;
    this.revision = revision;
    // Only send a library snapshot when it actually changes, never with each
    // radio pick. The worker owns it while songs are playing.
    return this.call('setTracks', tracks);
  }
  cancelPending() { Atomics.add(this.cancellation, 0, 1); this.awayFromSeed = false; }
  beginSession() { return this.call('beginSession'); }
  beginArtistSession(seed) { return this.call('beginArtistSession', seed); }
  beginExploreSession(seed) { return this.call('beginExploreSession', seed); }
  profileOptions(profile = null) {
    const source = profile && typeof profile === 'object' ? profile : {};
    return {
      familiarity: ['hits', 'balanced', 'deep-cuts'].includes(source.localRadioFamiliarity) ? source.localRadioFamiliarity : this.getFamiliarity(),
      tuning: { ...this.getTuning(), ...source }
    };
  }
  planInitialArtistSet(_tracks, seed, mode, stationKey, profile = null) {
    const options = this.profileOptions(profile);
    return this.call('planInitialArtistSet', seed, mode, stationKey, options.familiarity, options.tuning, Atomics.load(this.cancellation, 0));
  }
  record(track) { return this.call('record', track); }
  recordManualStart(track, mode, stationKey, set, profile = null) {
    const options = this.profileOptions(profile);
    return this.call('recordManualStart', track, mode, stationKey, set, options.familiarity, options.tuning);
  }
  recordFeedback(stationKey, track, kind) { return this.call('recordFeedback', stationKey, track, kind); }
  async choose(_tracks, seed, mode, excluded, reason, stationKey, deferDecision, profile = null) {
    const options = this.profileOptions(profile);
    const id = await this.call('choose', seed, mode, [...excluded], reason, stationKey, deferDecision, options.familiarity, options.tuning, Atomics.load(this.cancellation, 0));
    return id ? { id } : null;
  }
  publishDecision(decision) { return this.call('publishDecision', decision); }
  getLastDecision() { return this.lastDecision ? structuredClone(this.lastDecision) : null; }
  getLastSelectionMs() { return this.lastSelectionMs; }
  isAwayFromSeed() { return this.awayFromSeed; }
  flush() { return this.worker ? this.call('flush') : Promise.resolve(true); }
  close() {
    this.closed = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) void worker.terminate();
  }
}
module.exports = { RadioSelection };
