const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalize, radioArtist } = require('./music-tags');

const COOLDOWN = 4 * 60 * 60 * 1000;
const COMMON_TAGS = new Set(['rock', 'pop', 'country', 'jazz', 'blues', 'folk', 'metal', 'indie', 'dance', 'electronic', 'hip hop', 'hip-hop', 'rap', 'r&b', 'rnb', 'classical', 'soundtrack', 'alternative', 'soul', 'music']);

const matches = (a, b) => Boolean(a && b && normalize(a) === normalize(b));
const artistList = track => Array.isArray(track?.artists) && track.artists.length ? track.artists : [track?.artist];
const overlaps = (left = [], right = []) => left.some(a => right.some(b => matches(a, b)));
const stableId = track => crypto.createHash('sha256').update(String(track?.songKey || track?.id || '')).digest('hex').slice(0, 16);
const artistKey = track => normalize(radioArtist(track) || track?.artist || '');
function localRadioTuning(value = {}) {
  const songRepeatHours = Number(value.songRepeatHours ?? value.localRadioSongRepeatHours);
  const artistRepeatMinutes = Number(value.artistRepeatMinutes ?? value.localRadioArtistRepeatMinutes);
  const artistSetSize = Number(value.artistSetSize ?? value.localRadioArtistSetSize);
  return {
    songRepeatHours: [2, 4, 6].includes(songRepeatHours) ? songRepeatHours : 4,
    artistRepeatMinutes: [30, 90, 180].includes(artistRepeatMinutes) ? artistRepeatMinutes : 90,
    artistSetSize: [1, 2, 3, 4].includes(artistSetSize) ? artistSetSize : 1
  };
}

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
function mixRelationship(track, mix) {
  const reasons = [];
  const artist = radioArtist(track) || track?.artist || '';
  let strength = (mix?.artists || []).some(candidate => matches(candidate, artist)) ? 86 : 0;
  if (strength) reasons.push('curated Local Mix artist');
  for (const seed of mix?.seeds || []) {
    const relation = relationship(track, seed, 'radio');
    // Shared tags alone are too broad to expand a hand-curated station.
    const usable = relation.strength >= 62 || relation.reasons.includes('same album');
    if (usable && relation.strength > strength) {
      strength = relation.strength;
      reasons.splice(0, reasons.length, `connected to ${seed.artist}: ${relation.reasons[0]}`);
    }
  }
  return { seedArtist: '', reasons, strength, tags: [] };
}
function recentPenalty(track, seedArtist, history) {
  const recent = history.slice(0, 8); let multiplier = 1; const notes = [];
  if (!isSeedArtistTrack(track, seedArtist) && recent.slice(0, 3).some(item => matches(item.artist, track.artist))) { multiplier *= 0.2; notes.push('artist heard very recently'); }
  if (track.album && recent.slice(0, 2).some(item => matches(item.album, track.album))) { multiplier *= 0.35; notes.push('album heard very recently'); }
  return { multiplier, notes };
}
const FAMILIARITY_RATINGS = {
  hits: { minimum: 7, label: 'Favor the Hits', values: [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1, 1.35, 1.8, 2.35] },
  balanced: { minimum: 5, label: 'Balanced Mix', values: [0, 0.45, 0.55, 0.65, 0.8, 1, 1.13, 1.28, 1.45, 1.65, 1.85] },
  'deep-cuts': { minimum: 3, label: 'Play Deep Cuts Too', values: [0, 0.6, 0.7, 1, 1.04, 1.08, 1.12, 1.16, 1.2, 1.22, 1.24] }
};
function ratingOutOfTen(track) {
  const raw = track?.rating ?? (Number.isFinite(Number(track?.ratingStars)) ? Number(track.ratingStars) * 2 : NaN);
  const rating = Number(raw);
  return Number.isFinite(rating) && rating > 0 ? Math.max(1, Math.min(10, Math.round(rating))) : null;
}
function ratingMultiplier(track, familiarity) {
  const rating = ratingOutOfTen(track);
  if (rating === null) return { value: 1, note: 'unrated (neutral)' };
  const policy = FAMILIARITY_RATINGS[familiarity] || FAMILIARITY_RATINGS.balanced;
  return { value: policy.values[rating], note: `${rating}/10 MP3 rating` };
}
function favoriteMultiplier(track) {
  return track?.favorite === true
    ? { value: 2.25, note: 'FAVORITE tag' }
    : { value: 1, note: '' };
}
function feedbackMultiplier(entry = {}) {
  const up = Math.min(4, Number(entry.up) || 0);
  const down = Math.min(4, Number(entry.down) || 0);
  const skips = Math.max(0, Math.min(8, (Number(entry.skips) || 0) - Math.floor((Number(entry.completed) || 0) / 2)));
  const value = Math.max(0.08, 1 + (up * 0.18) - (down * 0.3) - (skips * 0.12));
  const parts = [];
  if (up) parts.push(`${up} thumbs-up`);
  if (down) parts.push(`${down} thumbs-down`);
  if (skips) parts.push(`${skips} skip${skips === 1 ? '' : 's'}`);
  return { value, note: parts.join(', ') };
}
function hasPersonalSignal(track, familiarity) {
  const policy = FAMILIARITY_RATINGS[familiarity] || FAMILIARITY_RATINGS.balanced;
  return track?.favorite === true || (ratingOutOfTen(track) || 0) >= policy.minimum;
}
function hasLastFmFamiliarity(track) {
  const popularity = Number(track?.popularity);
  return Number.isFinite(popularity) && popularity >= 60;
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
  const relation = mode === 'mix' ? mixRelationship(track, seed) : relationship(track, seed, mode);
  if (mode === 'radio' && Array.isArray(context?.secondarySeeds)) {
    for (const secondary of context.secondarySeeds) {
      const secondaryRelation = relationship(track, secondary, 'radio');
      if (secondaryRelation.strength >= 62 && secondaryRelation.strength * 0.5 > relation.strength) {
        relation.strength = secondaryRelation.strength * 0.5;
        relation.reasons = [`thumbs-up secondary seed: ${secondary.artist}`];
      }
    }
  }
  if (track?.doNotPlay) return { score: 0, excluded: 'do not play', relationship: relation, additions: [], multipliers: [] };
  if (last && now - last.at < (Number(context?.songCooldown) || COOLDOWN)) return { score: 0, excluded: 'cooldown', relationship: relation, additions: [], multipliers: [] };
  const heardArtistAt = context?.artistLast?.get(artistKey(track));
  if (heardArtistAt && artistKey(track) !== context?.setArtist && now - heardArtistAt < (Number(context?.artistCooldown) || 0)) {
    return { score: 0, excluded: 'artist cooldown', relationship: relation, additions: [], multipliers: [] };
  }
  if (!relation.strength) return { score: 0, excluded: 'no credible relationship', relationship: relation, additions: [], multipliers: [] };
  let score = relation.strength;
  const additions = [{ label: relation.reasons[0], amount: relation.strength }]; const multipliers = [];
  const recent = recentPenalty(track, relation.seedArtist, history); score *= recent.multiplier;
  if (recent.multiplier !== 1) multipliers.push({ label: 'Variety protection', value: recent.multiplier, source: recent.notes.join('; ') });
  const favorite = favoriteMultiplier(track); score *= favorite.value;
  if (favorite.value !== 1) multipliers.push({ label: 'Favorite', value: favorite.value, source: favorite.note });
  const rating = ratingMultiplier(track, familiarity); score *= rating.value; multipliers.push({ label: 'MP3 rating', value: rating.value, source: rating.note });
  const popularity = Number(track?.popularity);
  const familiarityScore = familiarityMultiplier(popularity, familiarity);
  score *= familiarityScore.value;
  multipliers.push({ label: 'Song familiarity', value: familiarityScore.value, source: `${familiarityScore.note}${Number.isFinite(popularity) ? ` · ${Math.round(popularity)}/100` : ''}` });
  const feedback = feedbackMultiplier(context?.feedback?.[track.songKey || track.id]);
  score *= feedback.value;
  if (feedback.note) multipliers.push({ label: 'Station feedback', value: feedback.value, source: feedback.note });
  const recentSeed = history.slice(0, mode === 'artist' ? 3 : 4).some(item => matches(item.artist, relation.seedArtist));
  if (mode !== 'mix' && isSeedArtistTrack(track, relation.seedArtist) && !recentSeed) { score *= 1.8; multipliers.push({ label: 'Seed anchor', value: 1.8, source: 'returning to the seed artist' }); }
  if (last) { score *= 0.7; multipliers.push({ label: 'Previously heard', value: 0.7, source: 'past the repeat wait' }); }
  return { score, excluded: '', relationship: relation, additions, multipliers, popularity: Number.isFinite(popularity) ? popularity : null };
}
function weight(track, seed, mode, history, now, context, familiarity) { return scoreTrack(track, seed, mode, history, now, context, familiarity).score; }

function cleanFeedback(value) {
  const stations = {};
  for (const [key, station] of Object.entries(value?.stations || {})) {
    if (!station || typeof station !== 'object') continue;
    const tracks = {};
    for (const [trackKey, entry] of Object.entries(station.tracks || {})) {
      const clean = {};
      for (const name of ['up', 'down', 'skips', 'completed']) {
        const count = Math.max(0, Math.min(99, Math.floor(Number(entry?.[name]) || 0)));
        if (count) clean[name] = count;
      }
      if (Object.keys(clean).length) tracks[String(trackKey)] = clean;
    }
    if (Object.keys(tracks).length) stations[String(key)] = { tracks };
  }
  return { version: 1, stations };
}

class MusicRadio {
  constructor({ dataDir, random = Math.random, now = Date.now, onDecision = () => {}, getFamiliarity = () => 'balanced', getTuning = () => ({}) }) {
    this.file = path.join(dataDir, 'music-history.json'); this.random = random; this.now = now; this.onDecision = onDecision; this.getFamiliarity = getFamiliarity; this.getTuning = getTuning;
    this.history = []; this.error = ''; this.lastDecision = null; this.artistSet = null;
    this.feedbackFile = path.join(dataDir, 'local-radio-feedback.json'); this.feedback = { version: 1, stations: {} };
    try { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(saved)) this.history = saved.filter(item => typeof item?.key === 'string' && Number.isFinite(item?.at)).slice(0, 5000); }
    catch (error) { if (error.code !== 'ENOENT') this.error = 'Music history could not be read; Local Radio is paused to protect repeat history.'; }
    try { this.feedback = cleanFeedback(JSON.parse(fs.readFileSync(this.feedbackFile, 'utf8'))); } catch {}
  }
  getLastDecision() { return this.lastDecision ? JSON.parse(JSON.stringify(this.lastDecision)) : null; }
  beginSession() { this.artistSet = null; }
  record(track) {
    this.history.unshift({ key: track.songKey, artist: track.artist, album: track.album, at: this.now() }); this.history = this.history.slice(0, 5000);
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.history)); fs.renameSync(this.file + '.tmp', this.file); }
    catch { this.error = 'Music history could not be saved; check that Data is writable.'; }
  }
  feedbackFor(stationKey) { return this.feedback.stations[String(stationKey)]?.tracks || {}; }
  recordFeedback(stationKey, track, kind) {
    const key = String(stationKey || '').trim(); const trackKey = String(track?.songKey || track?.id || '').trim();
    if (!key || !trackKey || !['up', 'down', 'skip', 'complete'].includes(kind)) return null;
    const station = this.feedback.stations[key] ||= { tracks: {} };
    const entry = station.tracks[trackKey] ||= {};
    const field = kind === 'skip' ? 'skips' : kind === 'complete' ? 'completed' : kind;
    entry[field] = Math.min(99, (Number(entry[field]) || 0) + 1);
    this.feedback = cleanFeedback(this.feedback);
    try { fs.mkdirSync(path.dirname(this.feedbackFile), { recursive: true }); fs.writeFileSync(this.feedbackFile + '.tmp', JSON.stringify(this.feedback)); fs.renameSync(this.feedbackFile + '.tmp', this.feedbackFile); } catch {}
    return this.feedbackFor(key)[trackKey] || null;
  }
  secondarySeeds(stationKey, tracks) {
    return Object.entries(this.feedbackFor(stationKey)).filter(([, value]) => Number(value.up) > Number(value.down || 0))
      .sort((a, b) => Number(b[1].up) - Number(a[1].up)).slice(0, 4)
      .map(([key]) => tracks.find(track => String(track.songKey || track.id) === key)).filter(Boolean);
  }
  choose(tracks, seed, mode, excluded = new Set(), selectionTrigger = 'next', stationKey = '') {
    if (this.error) throw new Error(this.error);
    const now = this.now(); const settings = localRadioTuning(this.getTuning());
    const context = { last: new Map(), artistLast: new Map(), songCooldown: settings.songRepeatHours * 60 * 60 * 1000, artistCooldown: settings.artistRepeatMinutes * 60 * 1000, setArtist: this.artistSet?.artist || '', feedback: this.feedbackFor(stationKey), secondarySeeds: mode === 'radio' ? this.secondarySeeds(stationKey, tracks) : [] };
    const familiarity = ['hits', 'balanced', 'deep-cuts'].includes(this.getFamiliarity()) ? this.getFamiliarity() : 'balanced';
    this.history.forEach(item => { if (!context.last.has(item.key)) context.last.set(item.key, item); if (!context.artistLast.has(artistKey(item))) context.artistLast.set(artistKey(item), item.at); });
    const forcedArtist = this.artistSet?.remaining > 0 ? this.artistSet.artist : '';
    const scored = tracks.filter(track => !excluded.has(track.id) && (!forcedArtist || artistKey(track) === forcedArtist)).map(track => ({ track, ...scoreTrack(track, seed, mode, this.history, now, context, familiarity) }));
    const cooldownExcluded = scored.filter(item => item.excluded === 'cooldown').length;
    const artistCooldownExcluded = scored.filter(item => item.excluded === 'artist cooldown').length;
    const doNotPlayExcluded = scored.filter(item => item.excluded === 'do not play').length;
    const credibleCandidates = scored.filter(item => item.score > 0); const credibleCount = credibleCandidates.length;
    // Each familiarity stop starts with the listener's own quality threshold.
    // Unrated songs stay neutral, but cannot displace qualifying rated/Favorite music.
    const personalCandidates = credibleCandidates.filter(item => hasPersonalSignal(item.track, familiarity));
    const lastFmCandidates = familiarity === 'hits' && !personalCandidates.length
      ? credibleCandidates.filter(item => hasLastFmFamiliarity(item.track)) : [];
    const candidates = personalCandidates.length ? personalCandidates : (lastFmCandidates.length ? lastFmCandidates : credibleCandidates);
    // A set is intentional, not a reason to pause radio. If its artist has no
    // second eligible track, end the set and immediately choose the next artist.
    if (!candidates.length && forcedArtist) {
      this.artistSet = null;
      return this.choose(tracks, seed, mode, excluded, selectionTrigger, stationKey);
    }
    let remaining = this.random() * candidates.reduce((sum, item) => sum + item.score, 0);
    const picked = candidates.find(item => (remaining -= item.score) < 0) || candidates.at(-1) || null;
    const selected = picked?.track || null;
    if (selected) {
      if (forcedArtist) {
        this.artistSet.remaining -= 1;
        if (this.artistSet.remaining <= 0) this.artistSet = null;
      } else if (settings.artistSetSize > 1) {
        this.artistSet = { artist: artistKey(selected), remaining: settings.artistSetSize - 1 };
      }
    } else if (forcedArtist) this.artistSet = null;
    const diagnostic = item => ({ diagnosticId: stableId(item.track), title: item.track.title, artist: item.track.artist, album: item.track.album, eligibilityReasons: item.relationship.reasons, score: item.score, additions: item.additions, multipliers: item.multipliers, favorite: item.track.favorite === true, rating: ratingOutOfTen(item.track), popularity: item.popularity, tags: item.relationship.tags });
    const ranked = [...candidates].sort((a, b) => b.score - a.score).slice(0, 8);
    const threshold = FAMILIARITY_RATINGS[familiarity].minimum;
    const poolLabel = personalCandidates.length ? `personal ${threshold}–10/Favorite` : (lastFmCandidates.length ? 'Last.fm familiar' : 'credible');
    this.lastDecision = { at: new Date(now).toISOString(), mode, stationKey, selectionTrigger, seed: { diagnosticId: stableId(seed), title: seed?.title || seed?.name || '', artist: seed?.artist || '', album: seed?.album || '', genres: seed?.genres || [] }, policy: 'automatic-local-radio-v2', familiarity, tuning: settings, artistSet: { size: settings.artistSetSize, remaining: this.artistSet?.remaining || 0 }, counts: { totalTracks: tracks.length, skippedByPlaybackError: excluded.size, skippedForCooldown: cooldownExcluded, skippedForArtistCooldown: artistCooldownExcluded, skippedForDoNotPlay: doNotPlayExcluded, credible: credibleCount, personal: personalCandidates.length, personalMinimum: threshold, lastFmFamiliar: lastFmCandidates.length, finalPool: candidates.length }, selected: selected ? diagnostic(picked) : null, diagnostics: { topFinalCandidates: ranked.map(diagnostic), recentHistory: this.history.slice(0, 12).map(item => ({ diagnosticId: stableId({ songKey: item.key }), artist: item.artist, album: item.album, at: new Date(item.at).toISOString() })) }, reason: selected ? `Picked from ${candidates.length} ${poolLabel} Local Radio candidates.` : 'No credible Local Radio song is currently available; waiting rather than making a poor leap.' };
    try { this.onDecision(this.getLastDecision()); } catch {}
    return selected;
  }
}
module.exports = { MusicRadio, weight, scoreTrack, COOLDOWN, cleanFeedback };
