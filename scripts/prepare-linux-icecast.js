// Bundle Icecast with the AppImage. The GitHub runner installs the distro package
// first; users only run WaveDeck and do not install or launch a server themselves.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.cache', 'wavedeck-tools', 'linux', 'icecast');
const bin = process.env.WAVEDECK_ICECAST_PATH || '/usr/bin/icecast2';
if (!fs.existsSync(bin)) {
  console.error('Icecast 2 is required to build the Linux AppImage. Install icecast2 on the build machine.');
  process.exit(1);
}
fs.mkdirSync(path.join(output, 'lib'), { recursive: true });
fs.copyFileSync(bin, path.join(output, 'icecast2'));
fs.chmodSync(path.join(output, 'icecast2'), 0o755);
const linked = execFileSync('ldd', [bin], { encoding: 'utf8' });
for (const match of linked.matchAll(/=>\s+(\/[^\s]+)\s+\(/g)) {
  const source = match[1];
  // Keep system glibc/loader. Bundle Icecast's other shared dependencies.
  if (/\/lib(?:c|m|pthread|dl|rt|resolv|nss_[^/]*)\.so\./.test(source)) continue;
  fs.copyFileSync(source, path.join(output, 'lib', path.basename(source)));
}
console.log('Prepared Icecast for the WaveDeck Opus AppImage.');
