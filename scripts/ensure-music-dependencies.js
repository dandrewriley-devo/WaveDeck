// The desktop development launcher runs git pull + npm start. Install the new
// pure-JS/WASM music dependencies once, without requiring a launcher replacement.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
let missing = false;
for (const name of ['music-metadata', 'sql.js']) {
  try {
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (installed.version !== pkg.dependencies[name]) missing = true;
  } catch { missing = true; }
}
if (missing) {
  console.log('WaveDeck: installing local music support (first launch only)…');
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32'
  });
  if (result.error || result.status !== 0) { console.error('Music dependencies could not be installed. Check your connection and run npm install.'); process.exit(1); }
}
