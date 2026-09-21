const fs = require('fs');
const path = require('path');
const { normalize, radioArtist } = require('./music-tags');
const COOLDOWN = 120 * 60 * 1000;
const matches = (a, b) => Boolean(a && b && normalize(a) === normalize(b));
const overlaps = (a = [], b = []) => a.some(x => b.some(y => matches(x, y)));
function weight(track, seed, mode, history, now, context = null) {
  // 1–2 / 10 = one star; 3–4 / 10 = two stars. Unrated is neutral.
  if (track.rating !== null && track.rating <= 2) return 0;
  const last = context ? context.last.get(track.songKey) : history.find(h => h.key === track.songKey);
  if (last && now - last.at < COOLDOWN) return 0;
  let score = 1;
  if (matches(track.artist, mode === 'artist' ? radioArtist(seed) : seed.artist)) score += 7;
  if (overlaps(track.artists, [radioArtist(seed)])) score += 4;
  if (overlaps(track.genres, seed.genres)) score += 5;
  if (overlaps(track.similarArtists, [seed.artist]) || overlaps(seed.similarArtists, [track.artist])) score += 6;
  if (overlaps(track.moods, seed.moods)) score += 2;
  if (seed.year && track.year) score += Math.max(0, 2 - Math.abs(seed.year - track.year) / 10);
  // Bounded preference boosts preserve room for deep cuts and unrated songs.
  score *= track.rating === null ? 1 : track.rating <= 4 ? 0.08 : 0.8 + track.rating * 0.08;
  if (track.favorite) score *= 1.25;
  score *= 1 + Math.min(100, Math.max(0, track.popularity || 0)) / 250;
  score *= 1 + Math.min(0.15, Math.log1p(Math.max(0, track.playCount || 0)) / 40);
  if (last) score *= 0.55; // Fresh tracks stay attractive even after the two-hour lock expires.
  if (history.slice(0, 3).some(h => matches(h.artist, track.artist))) score *= 0.18;
  if (history.slice(0, 5).some(h => h.album && matches(h.album, track.album) && matches(h.artist, track.artist))) score *= 0.5;
  // Avoid replaying familiar transitions, not merely entire saved playlists.
  const previous = history[0]?.key;
  if (previous && (context ? context.successors.has(track.songKey) : history.some((h, i) => h.key === track.songKey && history[i + 1]?.key === previous))) score *= 0.02;
  return score;
}
class MusicRadio {
  constructor({ dataDir, random = Math.random, now = Date.now }) {
    this.file = path.join(dataDir, 'music-history.json'); this.random = random; this.now = now;
    this.history = []; this.error = '';
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(parsed)) this.history = parsed.filter(h => typeof h.key === 'string' && Number.isFinite(h.at)).slice(0, 5000);
    } catch (error) { if (error.code !== 'ENOENT') this.error = 'Music history could not be read; automatic radio is disabled to preserve repeat protection.'; }
  }
  record(track) {
    this.history.unshift({ key: track.songKey, artist: track.artist, album: track.album, at: this.now() });
    this.history = this.history.slice(0, 5000);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.history));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch { this.error = 'Music history could not be saved; check that Data is writable.'; }
  }
  choose(tracks, seed, mode, excluded = new Set()) {
    if (this.error) throw new Error(this.error);
    const now = this.now();
    const context = { last: new Map(), successors: new Set() };
    this.history.forEach((h, i) => {
      if (!context.last.has(h.key)) context.last.set(h.key, h);
      if (this.history[i + 1]?.key === this.history[0]?.key) context.successors.add(h.key);
    });
    let candidates = tracks.filter(t => !excluded.has(t.id)).map(track => ({ track, score: weight(track, seed, mode, this.history, now, context) })).filter(c => c.score > 0);
    const related = candidates.filter(({ track }) => matches(track.artist, radioArtist(seed)) ||
      overlaps(track.genres, seed.genres) || overlaps(track.artists, seed.artists) ||
      overlaps(seed.similarArtists, [track.artist]) || overlaps(track.similarArtists, [seed.artist]) || overlaps(track.moods, seed.moods));
    // Unrelated tracks must not overwhelm a smaller relevant pool by sheer count.
    // Broaden only after the available related pool is exhausted by cooldowns.
    if (related.length) candidates = related;
    const previous = this.history[0]?.key;
    const pastSuccessor = this.history.find((h, i) => this.history[i + 1]?.key === previous)?.key;
    const freshTransitions = candidates.filter(c => c.track.songKey !== pastSuccessor);
    if (freshTransitions.length) candidates = freshTransitions;
    let remaining = this.random() * candidates.reduce((sum, c) => sum + c.score, 0);
    for (const candidate of candidates) { remaining -= candidate.score; if (remaining < 0) return candidate.track; }
    return candidates.at(-1)?.track || null;
  }
}
module.exports = { MusicRadio, weight, COOLDOWN };
