const { parentPort, workerData } = require('worker_threads');
const { MusicRadio } = require('./music-radio');

let tracks = [];
let familiarity = 'balanced';
let tuning = {};
const cancellation = new Int32Array(workerData.cancelBuffer);
let requestGeneration = Atomics.load(cancellation, 0);
const radio = new MusicRadio({
  dataDir: workerData.dataDir,
  getFamiliarity: () => familiarity,
  getTuning: () => tuning,
  shouldCancel: () => Atomics.load(cancellation, 0) !== requestGeneration,
  onDecision: decision => parentPort.postMessage({ event: 'decision', value: decision })
});

// A single ordered lane keeps session changes, feedback, preparation, and
// publication in the same order as the transport commands that sent them.
let lane = Promise.resolve();
parentPort.on('message', message => {
  lane = lane.then(async () => {
    const { id, method, args = [] } = message;
    let value;
    let selectionMs = null;
    switch (method) {
      case 'setTracks': tracks = args[0]; break;
      case 'beginSession': radio.beginSession(); break;
      case 'beginArtistSession': radio.beginArtistSession(args[0]); break;
      case 'beginExploreSession': radio.beginExploreSession(args[0]); break;
      case 'planInitialArtistSet':
        [familiarity, tuning] = [args[3], args[4]];
        requestGeneration = args[5];
        if (radio.shouldCancel()) throw new Error('Local Radio selection canceled.');
        value = radio.planInitialArtistSet(tracks, ...args.slice(0, 3));
        break;
      case 'record': radio.record(args[0]); break;
      case 'recordManualStart':
        [familiarity, tuning] = [args[4], args[5]];
        value = radio.recordManualStart(...args.slice(0, 4));
        break;
      case 'recordFeedback': value = radio.recordFeedback(...args); break;
      case 'choose':
        [familiarity, tuning] = [args[6], args[7]];
        requestGeneration = args[8];
        if (radio.shouldCancel()) throw new Error('Local Radio selection canceled.');
        selectionMs = performance.now();
        value = radio.choose(tracks, args[0], args[1], new Set(args[2]), args[3], args[4], args[5])?.id || null;
        selectionMs = Math.round(performance.now() - selectionMs);
        break;
      case 'publishDecision': value = radio.publishDecision(args[0]); break;
      case 'flush': value = await radio.flush(); break;
      default: throw new Error(`Unknown radio operation: ${method}`);
    }
    parentPort.postMessage({ id, value, decision: radio.getLastDecision(), awayFromSeed: radio.isAwayFromSeed(), selectionMs });
  }).catch(error => {
    parentPort.postMessage({ id: message.id, error: error.message });
  });
});
