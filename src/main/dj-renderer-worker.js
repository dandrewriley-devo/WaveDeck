const { parentPort, workerData } = require('worker_threads');
const { KokoroTTS } = require('kokoro-js');

let tts = null;

async function renderer() {
  if (tts) return tts;
  tts = await KokoroTTS.from_pretrained(workerData.modelDir, {
    dtype: 'q8', device: 'cpu', local_files_only: true
  });
  return tts;
}

(async () => {
  await renderer();
  parentPort.postMessage({ ready: true });
  parentPort.on('message', async request => {
    try {
      const engine = await renderer();
      const audio = await engine.generate(String(request.text || ''), { voice: 'af_heart', speed: 1 });
      await audio.save(request.wavPath);
      parentPort.postMessage({ id: request.id, ok: true });
    } catch (error) {
      parentPort.postMessage({ id: request.id, ok: false, error: error?.message || String(error) });
    }
  });
})().catch(error => parentPort.postMessage({ ready: false, error: error?.message || String(error) }));
