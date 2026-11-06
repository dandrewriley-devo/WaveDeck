const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const TARGET_LUFS = -16;
const PAUSE_MS = 30_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class ReplayGain {
  constructor({ dataDir, getTracks, ffmpegPath, onStatus = () => {}, canAnalyze = () => true }) {
    this.file = path.join(dataDir, 'replay-gain.jsonl');
    this.getTracks = getTracks; this.ffmpegPath = ffmpegPath; this.onStatus = onStatus; this.canAnalyze = canAnalyze;
    this.entries = new Map(); this.enabled = false; this.paused = false; this.running = null; this.timer = null; this.quietUntil = 0; this.cursor = 0;
    try {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line) continue;
        try { const entry = JSON.parse(line); if (entry.key && Number.isFinite(entry.gainDb)) this.entries.set(entry.key, entry); } catch {}
      }
    } catch {}
  }
  key(track) { return String(track?.relativePath || '').replace(/\\/g, '/'); }
  source(track) { return path.join(path.dirname(path.dirname(this.file)), 'Music', this.key(track)); }
  gainFor(track) { return this.enabled ? this.entries.get(this.key(track))?.gainDb || 0 : 0; }
  status() {
    const tracks = this.getTracks().filter(track => track.library === 'portable');
    return { enabled: this.enabled, paused: this.paused, running: Boolean(this.running), ready: tracks.filter(track => this.entries.has(this.key(track))).length, total: tracks.length };
  }
  emit() { this.onStatus(this.status()); }
  setSettings({ enabled, paused } = {}) {
    if (typeof enabled === 'boolean') this.enabled = enabled;
    if (typeof paused === 'boolean') this.paused = paused;
    if (this.paused || !this.enabled) { clearTimeout(this.timer); this.running?.kill('SIGTERM'); }
    else this.schedule(1000);
    this.emit(); return this.status();
  }
  deferForPlayback() {
    this.quietUntil = Date.now() + 60_000;
    this.running?.kill('SIGTERM');
    if (this.enabled && !this.paused) this.schedule(60_000);
  }
  schedule(delay = PAUSE_MS) {
    clearTimeout(this.timer);
    if (!this.enabled || this.paused) return;
    this.timer = setTimeout(() => void this.analyzeNext(), Math.max(delay, this.quietUntil - Date.now()));
    this.timer.unref?.();
  }
  async analyzeNext() {
    if (!this.enabled || this.paused || this.running) return;
    if (Date.now() < this.quietUntil || !this.canAnalyze()) return this.schedule(PAUSE_MS);
    const tracks = this.getTracks().filter(track => track.library === 'portable');
    if (!tracks.length) return this.schedule(PAUSE_MS);
    for (let checked = 0; checked < tracks.length; checked += 1) {
      const track = tracks[this.cursor++ % tracks.length];
      if (this.entries.has(this.key(track))) continue;
      try {
        const source = this.source(track);
        const stat = await fsp.stat(source);
        if (!this.enabled || this.paused || Date.now() < this.quietUntil) break;
        const child = spawn(this.ffmpegPath(), ['-hide_banner', '-nostdin', '-threads', '1', '-filter_threads', '1', '-i', source, '-vn', '-sn', '-dn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
        this.running = child;
        try { os.setPriority(child.pid, 19); } catch {}
        execFile('ionice', ['-c', '3', '-p', String(child.pid)], () => {});
        let tail = '';
        child.stderr.on('data', chunk => { tail = (tail + chunk.toString()).slice(-24000); });
        const code = await new Promise(resolve => { child.once('error', () => resolve(-1)); child.once('exit', value => resolve(value)); });
        this.running = null;
        if (code === 0 && this.enabled && !this.paused) {
          const integrated = [...tail.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)].at(-1);
          const peak = [...tail.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)].at(-1);
          if (integrated && Number.isFinite(Number(integrated[1]))) {
            const wanted = TARGET_LUFS - Number(integrated[1]);
            const gainDb = clamp(Math.min(wanted, peak ? -1 - Number(peak[1]) : wanted), -12, 12);
            const entry = { key: this.key(track), gainDb, lufs: Number(integrated[1]), size: stat.size, mtime: stat.mtimeMs };
            await fsp.appendFile(this.file, `${JSON.stringify(entry)}\n`);
            this.entries.set(entry.key, entry);
            this.emit();
          }
        }
      } catch { this.running = null; }
      break;
    }
    this.schedule(PAUSE_MS);
  }
  close() { clearTimeout(this.timer); this.running?.kill('SIGTERM'); }
}
module.exports = { ReplayGain, TARGET_LUFS };
