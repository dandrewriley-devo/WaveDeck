const path = require('path');

const appDir = process.argv[2];
if (!appDir) throw new Error('Expected the extracted AppImage directory.');

const { KokoroTTS } = require('kokoro-js');
const modelDir = path.join(appDir, 'resources', 'dj-models', 'Kokoro-82M-v1.0-ONNX');

(async () => {
  const tts = await KokoroTTS.from_pretrained(modelDir, {
    dtype: 'q8', device: 'cpu', local_files_only: true
  });
  const audio = await tts.generate('WaveDeck DJ voice check.', { voice: 'af_heart', speed: 1 });
  if (!audio?.audio?.length) throw new Error('The packaged DJ voice returned no audio.');
  console.log('Packaged DJ voice check passed.');
})().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
