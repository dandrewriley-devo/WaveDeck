const fs = require('fs');
const path = require('path');

function parseCue(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{1,3}:[0-5]\d$/.test(value.trim())) throw new Error('Use m:ss for song start and end points.');
  const [minutes, seconds] = value.trim().split(':').map(Number);
  return minutes * 60 + seconds;
}

function formatCue(seconds) {
  if (seconds === null || seconds === undefined) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

class SongCues {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'song-cues.json');
    this.entries = {};
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [id, cue] of Object.entries(saved?.tracks || {})) {
        if (!id || id.length > 300 || !cue || typeof cue !== 'object') continue;
        const start = Number.isInteger(cue.start) && cue.start >= 0 ? cue.start : null;
        const end = Number.isInteger(cue.end) && cue.end > 0 ? cue.end : null;
        if (start !== null || end !== null) this.entries[id] = { start, end };
      }
    } catch {}
  }
  get(id) { return this.entries[String(id)] || { start: null, end: null }; }
  set(track, values) {
    if (!track?.id || track.library !== 'portable') throw new Error('Choose a portable song.');
    const start = parseCue(values?.start);
    const end = parseCue(values?.end);
    const duration = Number(track.duration);
    if (start !== null && start >= duration - 1) throw new Error('Start must be before the song ends.');
    if (end !== null && end > duration + 1) throw new Error('End must be within the song.');
    if (end !== null && end <= (start ?? 0) + 1) throw new Error('End must be after Start.');
    if (start === null && end === null) delete this.entries[track.id];
    else this.entries[track.id] = { start, end };
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, tracks: this.entries }, null, 2)}\n`);
    fs.renameSync(temporary, this.file);
    return { start: formatCue(start), end: formatCue(end) };
  }
  display(id) { const cue = this.get(id); return { start: formatCue(cue.start), end: formatCue(cue.end) }; }
}

module.exports = { SongCues, parseCue, formatCue };
