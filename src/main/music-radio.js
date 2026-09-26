const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalize, radioArtist } = require('./music-tags');

// Local Radio is automatic. These are safeguards, not listener tuning controls.
const COOLDOWN = 120 * 60 * 1000;
const COMMON_TAGS = new Set(['rock', 'pop', 'country', 'jazz', 'blues', 'folk', 'metal', 'indie', 'dance', 'electronic', 'hip hop', 'hip-hop', 'rap', 'r&b', 'rnb', 'classical', 'soundtrack', 'alternative', 'soul', 'music']);

const matches = (a, b) => Boolean(a && b && normalize(a) === normalize(b));
const artistList = track => Array.isArray(track?.artists) && track.artists.length ? track.artists : [track?.artist];
const overlaps = (left = [], right = []) => left.some(a => right.some(b => matches(a, b)));
const stableId = track => crypto.createHash('sha256').update(String(track?.songKey || track?.id || '')).digest('hex').slice(0, 16);

function specificSharedTags(left = [], right = []) {
  const result = [];
  for (const tag of left) {
    const key = normalize(tag);
    if (!key || COMMON_TAGS.has(key) || !right.some(other => matches(tag, other))) continue;
    if (!result.some(other => matches(other, tag))) result.push(String(tag));
  }
  return result;
}
function isSeedArtistTrack(track, seedArtist) { return overlaps(artistList(track), [seedArtist]); }
function sameAlbum(track, seed) {
  return Boolean(track?.album && seed?.album && matches(track.album, seed.album) && matches(track.albumArtist || track.artist, seed.albumArtist || seed.artist));
}
function relationship(track, seed, mode) {
  const seedArtist = mode === 'artist' ? radioArtist(seed) : seed?.artist;
  const seedArtists = artistList(seed);
  const reasons = []; let strength = 0;
  if (mode === 'radio' && sameAlbum(track, seed)) { reasons.push('same album'); strength = 100; }
  if (isSeedArtistTrack(track, seedArtist)) { reasons.push('seed artist'); strength = Math.max(strength, 88); }
  else if (overlaps(artistList(track), seedArtists)) { reasons.push('shared credited artist'); strength = Math.max(strength, 72); }
  if (overlaps(seed?.similarArtists || [], [track?.artist]) || overlaps(track?.similarArtists || [], [seedArtist])) { reasons.push('Last.fm similar artist'); strength = Math.max(strength, 62); }
  const tags = specificSharedTags(track?.genres || [], seed?.genres || []);
  if (tags.length) { reasons.push(`specific shared tag${tags.length === 1 ? '' : 's'}: ${tags.slice(0, 2).join(', ')}`); strength = Math.max(strength, 28 + Math.min(16, tags.length * 8)); }
  return { seedArtist, reasons, strength, tags };
}
function recentPenalty(track, seedArtist, history) {
  const recent = history.slice(0, 8); let multiplier = 1; const notes = [];
  if (!isSeedArtistTrack(track, seedArtist) && recent.slice(0, 3).some(item => matches(item.artist, track.artist))) { multiplier *= 0.2; notes.push('artist heard very recently'); }
  if (track.album && recent.slice(0, 2).some(item => matches(item.album, track.album))) { multiplier *= 0.35; notes.push('album heard very recently'); }
  return { multiplier, notes };
}
function ratingMultiplier(track) {
  const raw = track?.ratingStars ?? (Number.isFinite(Number(track?.rating)) ? Number(track.rating) / 2 : NaN);
  const rating = Number(raw);
  if (!Number.isFinite(rating)) return { value: 1, note: 'unrated (neutral)' };
  return { value: Math.max(0.55, Math.min(1.3, 0.7 + rating * 0.12)), note: `${Math.round(rating * 10) / 10}/5 MP3 rating` };
}
function familiarityMultiplier(popularity, familiarity) {
  if (!Number.isFinite(popularity)) return { value: 1, note: 'missing (neutral)' };
  const score = Math.max(0, Math.min(100, popularity));
  if (familiarity === 'hits') return { value: 0.85 + (score * 0.0045), note: 'Favor the Hits' };
  if (familiarity === 'deep-cuts') return { value: 1.25 - (score * 0.0035), note: 'Play Deep Cuts Too' };
  return { value: 1 + (score * 0.002), note: 'Balanced Mix' };
}
function scoreTrack(track, seed, mode, history = [], now = Date.now(), context = null, familiarity = 'balanced') {
  const last = context?.last?.get(track.songKey) || history.find(item => item.key === track.songKey);
  const relation = relationship(track, seed, mode);
  if (last && now - last.at < COOLDOWN) return { score: 0, excluded: 'cooldown', relationship: relation, additions: [], multipliers: [] };
  if (!relation.strength) return { score: 0, excluded: 'no credible relationship', relationship: relation, additions: [], multipliers: [] };
  let score = relation.strength;
  const additions = [{ label: relation.reasons[0], amount: relation.strength }]; const multipliers = [];
  const recent = recentPenalty(track, relation.seedArtist, history); score *= recent.multiplier;
  if (recent.multiplier !== 1) multipliers.push({ label: 'Variety protection', value: recent.multiplier, source: recent.notes.join('; ') });
  const rating = ratingMultiplier(track); score *= rating.value; multipliers.push({ label: 'MP3 rating', value: rating.value, source: rating.note });
  const popularity = Number(track?.popularity);
  const familiarityScore = familiarityMultiplier(popularity, familiarity);
  score *= familiarityScore.value;
  multipliers.push({ label: 'Song familiarity', value: familiarityScore.value, source: `${familiarityScore.note}${Number.isFinite(popularity) ? ` · ${Math.round(popularity)}/100` : ''}` });
  const recentSeed = history.slice(0, mode === 'artist' ? 3 : 4).some(item => matches(item.artist, relation.seedArtist));
  if (isSeedArtistTrack(track, relation.seedArtist) && !recentSeed) { score *= 1.8; multipliers.push({ label: 'Seed anchor', value: 1.8, source: 'returning to the seed artist' }); }
  if (last) { score *= 0.7; multipliers.push({ label: 'Previously heard', value: 0.7, source: 'past the repeat wait' }); }
  return { score, excluded: '', relationship: relation, additions, multipliers, popularity: Number.isFinite(popularity) ? popularity : null };
}
function weight(track, seed, mode, history, now, context, familiarity) { return scoreTrack(track, seed, mode, history, now, context, familiarity).score; }

class MusicRadio {
  constructor({ dataDir, random = Math.random, now = Date.now, onDecision = () => {}, getFamiliarity = () => 'balanced' }) {
    this.file = path.join(dataDir, 'music-history.json'); this.random = random; this.now = now; this.onDecision = onDecision; this.getFamiliarity = getFamiliarity;
    this.history = []; this.error = ''; this.lastDecision = null;
    try { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(saved)) this.history = saved.filter(item => typeof item?.key === 'string' && Number.isFinite(item?.at)).slice(0, 5000); }
    catch (error) { if (error.code !== 'ENOENT') this.error = 'Music history could not be read; Local Radio is paused to protect repeat history.'; }
  }
  getLastDecision() { return this.lastDecision ? JSON.parse(JSON.stringify(this.lastDecision)) : null; }
  record(track) {
    this.history.unshift({ key: track.songKey, artist: track.artist, album: track.album, at: this.now() }); this.history = this.history.slice(0, 5000);
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.history)); fs.renameSync(this.file + '.tmp', this.file); }
    catch { this.error = 'Music history could not be saved; check that Data is writable.'; }
  }
  choose(tracks, seed, mode, excluded = new Set(), selectionTrigger = 'next') {
    if (this.error) throw new Error(this.error);
    const now = this.now(); const context = { last: new Map() };
    const familiarity = ['hits', 'balanced', 'deep-cuts'].includes(this.getFamiliarity()) ? this.getFamiliarity() : 'balanced';
    this.history.forEach(item => { if (!context.last.has(item.key)) context.last.set(item.key, item); });
    const scored = tracks.filter(track => !excluded.has(track.id)).map(track => ({ track, ...scoreTrack(track, seed, mode, this.history, now, context, familiarity) }));
    const cooldownExcluded = scored.filter(item => item.excluded === 'cooldown').length;
    const candidates = scored.filter(item => item.score > 0); const credibleCount = candidates.length;
    let remaining = this.random() * candidates.reduce((sum, item) => sum + item.score, 0);
    const picked = candidates.find(item => (remaining -= item.score) < 0) || candidates.at(-1) || null;
    const selected = picked?.track || null;
    const diagnostic = item => ({ diagnosticId: stableId(item.track), title: item.track.title, artist: item.track.artist, album: item.track.album, eligibilityReasons: item.relationship.reasons, score: item.score, additions: item.additions, multipliers: item.multipliers, popularity: item.popularity, tags: item.relationship.tags });
    const ranked = [...candidates].sort((a, b) => b.score - a.score).slice(0, 8);
    this.lastDecision = { at: new Date(now).toISOString(), mode, selectionTrigger, seed: { diagnosticId: stableId(seed), title: seed?.title || '', artist: seed?.artist || '', album: seed?.album || '', genres: seed?.genres || [] }, policy: 'automatic-local-radio-v1', familiarity, counts: { totalTracks: tracks.length, skippedByPlaybackError: excluded.size, skippedForCooldown: cooldownExcluded, credible: credibleCount, finalPool: candidates.length }, selected: selected ? diagnostic(picked) : null, diagnostics: { topFinalCandidates: ranked.map(diagnostic), recentHistory: this.history.slice(0, 12).map(item => ({ diagnosticId: stableId({ songKey: item.key }), artist: item.artist, album: item.album, at: new Date(item.at).toISOString() })) }, reason: selected ? `Picked from ${candidates.length} credible Local Radio candidates.` : 'No credible Local Radio song is currently available; waiting rather than making a poor leap.' };
    try { this.onDecision(this.getLastDecision()); } catch {}
    return selected;
  }
}
module.exports = { MusicRadio, weight, scoreTrack, COOLDOWN };
