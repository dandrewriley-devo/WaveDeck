/* Downloads the one local voice model bundled with WaveDeck DJ's AppImage. */
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, '.cache', 'wavedeck-tools', 'dj-models', 'Kokoro-82M-v1.0-ONNX');
const BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/';
// q8 is a practical CPU model for quiet background work. The af_heart voice
// itself comes from the kokoro-js package, which is also bundled in the AppImage.
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx'
];

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url), destination));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Could not download ${url}: HTTP ${response.statusCode}.`));
      }
      const stream = fs.createWriteStream(destination);
      response.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
      stream.on('error', reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error(`Timed out downloading ${url}.`)));
    request.on('error', reject);
  });
}

async function valid(file) {
  try { return (await fsp.stat(file)).size > 0; } catch { return false; }
}

async function main() {
  for (const relative of FILES) {
    const destination = path.join(OUTPUT, relative);
    if (await valid(destination)) continue;
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    const partial = `${destination}.part`;
    await fsp.rm(partial, { force: true });
    process.stdout.write(`Downloading bundled DJ voice model: ${relative}\n`);
    await download(`${BASE}${relative}`, partial);
    await fsp.rename(partial, destination);
  }
  const model = path.join(OUTPUT, 'onnx', 'model_quantized.onnx');
  const hash = crypto.createHash('sha256').update(await fsp.readFile(model)).digest('hex');
  process.stdout.write(`Prepared bundled Kokoro af_heart model (${hash}).\n`);
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
