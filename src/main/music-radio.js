const fs = require('fs');
const path = require('path');
const { normalize, radioArtist } = require('./music-tags');
const RULE_FILES = { artist: 'artist-radio-rules.json', radio: 'song-radio-rules.json' };
const RULES_REFERENCE_FILE = 'music-radio-rules-reference.txt';
const DEFAULT_RULES = {
  artist: {
    version: 1, repeatCooldownMinutes: 120, excludeRatingAtOrBelow: 2, lowRatingMaximum: 4,
    lowRatingMultiplier: 0.08, ratingBaseMultiplier: 0.8, ratingStepMultiplier: 0.08,
    sameArtistWeight: 7, featuredArtistWeight: 4, genreWeight: 5, similarArtistWeight: 6,
    moodWeight: 2, eraWeight: 2, eraYearRange: 10, favoriteMultiplier: 1.25,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1,
    popularityMaximum: 100, popularityDivisor: 250, playCountBoostMaximum: 0.15,
    playCountLogDivisor: 40, postCooldownMultiplier: 0.55, recentArtistCount: 3,
    recentArtistMultiplier: 0.18, recentAlbumCount: 5, recentAlbumMultiplier: 0.5,
    repeatedTransitionMultiplier: 0.02
  },
  radio: {
    version: 1, repeatCooldownMinutes: 120, excludeRatingAtOrBelow: 2, lowRatingMaximum: 4,
    lowRatingMultiplier: 0.08, ratingBaseMultiplier: 0.8, ratingStepMultiplier: 0.08,
    sameArtistWeight: 7, featuredArtistWeight: 4, genreWeight: 5, similarArtistWeight: 6,
    moodWeight: 2, eraWeight: 2, eraYearRange: 10, favoriteMultiplier: 1.25,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1,
    popularityMaximum: 100, popularityDivisor: 250, playCountBoostMaximum: 0.15,
    playCountLogDivisor: 40, postCooldownMultiplier: 0.55, recentArtistCount: 3,
    recentArtistMultiplier: 0.18, recentAlbumCount: 5, recentAlbumMultiplier: 0.5,
    repeatedTransitionMultiplier: 0.02
  }
};
const COOLDOWN = DEFAULT_RULES.artist.repeatCooldownMinutes * 60 * 1000;
const RULE_MINIMUMS = { repeatCooldownMinutes: 120, eraYearRange: 1, popularityDivisor: 1, playCountLogDivisor: 1 };
const RULE_MAXIMUMS = { repeatCooldownMinutes: 10080, selectionRandomness: 10 };
const RULES_REFERENCE = `WaveDeck Music Radio Rules\n\n` +
`artist-radio-rules.json controls Artist Radio.\n` +
`song-radio-rules.json controls Song Radio.\n\n` +
`Edit the number after a setting name, save the file, and WaveDeck uses the new value before choosing its next radio song. Invalid files use built-in defaults until fixed.\n\n` +
`repeatCooldownMinutes: Minimum time before the same song may repeat. WaveDeck will never allow less than 120 minutes.\n` +
`sameArtistWeight, featuredArtistWeight, genreWeight, similarArtistWeight, moodWeight, eraWeight: Higher values make that connection more important.\n` +
`eraYearRange: Number of years over which era similarity fades.\n` +
`unrelatedTrackMultiplier: 0 keeps selection inside the related pool whenever possible. A value between 0 and 1 allows a smaller amount of unrelated variety.\n` +
`selectionRandomness: 1 uses the normal weighted balance. Lower values flatten the weights for more surprise; higher values favor the strongest matches.\n` +
`excludeRatingAtOrBelow: Tracks at or below this 1-10 rating are not selected automatically.\n` +
`lowRatingMaximum and lowRatingMultiplier: Make lower-rated tracks rare without excluding them.\n` +
`ratingBaseMultiplier and ratingStepMultiplier: Control the boost for ratings above lowRatingMaximum.\n` +
`favoriteMultiplier, popularityMaximum, popularityDivisor, playCountBoostMaximum, playCountLogDivisor: Tune preference and popularity boosts.\n` +
`postCooldownMultiplier: Keeps a song less likely even after its cooldown ends.\n` +
`recentArtistCount/recentArtistMultiplier and recentAlbumCount/recentAlbumMultiplier: Discourage artist and album clustering.\n` +
`repeatedTransitionMultiplier: Discourages the same song-to-song transition from recurring.\n`;
const matches = (a, b) => Boolean(a && b && normalize(a) === normalize(b));
const overlaps = (a = [], b = []) => a.some(x => b.some(y => matches(x, y)));
const clone = value => JSON.parse(JSON.stringify(value));
function validatedRules(value, defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clone(defaults);
  const result = clone(defaults);
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === 'version') continue;
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate) && candidate >= 0) {
      result[key] = Math.min(RULE_MAXIMUMS[key] || 10000, Math.max(RULE_MINIMUMS[key] || 0, candidate));
    }
  }
  return result;
}
function weight(track, seed, mode, history, now, context = null, rules = DEFAULT_RULES[mode] || DEFAULT_RULES.radio) {
  // 1–2 / 10 = one star; 3–4 / 10 = two stars. Unrated is neutral.
  if (track.rating !== null && track.rating <= rules.excludeRatingAtOrBelow) return 0;
  const last = context ? context.last.get(track.songKey) : history.find(h => h.key === track.songKey);
  if (last && now - last.at < rules.repeatCooldownMinutes * 60 * 1000) return 0;
  let score = 1;
  if (matches(track.artist, mode === 'artist' ? radioArtist(seed) : seed.artist)) score += rules.sameArtistWeight;
  if (overlaps(track.artists, [radioArtist(seed)])) score += rules.featuredArtistWeight;
  if (overlaps(track.genres, seed.genres)) score += rules.genreWeight;
  if (overlaps(track.similarArtists, [seed.artist]) || overlaps(seed.similarArtists, [track.artist])) score += rules.similarArtistWeight;
  if (overlaps(track.moods, seed.moods)) score += rules.moodWeight;
  if (seed.year && track.year) score += Math.max(0, rules.eraWeight - Math.abs(seed.year - track.year) / rules.eraYearRange);
  // Bounded preference boosts preserve room for deep cuts and unrated songs.
  score *= track.rating === null ? 1 : track.rating <= rules.lowRatingMaximum ? rules.lowRatingMultiplier : rules.ratingBaseMultiplier + track.rating * rules.ratingStepMultiplier;
  if (track.favorite) score *= rules.favoriteMultiplier;
  score *= 1 + Math.min(rules.popularityMaximum, Math.max(0, track.popularity || 0)) / rules.popularityDivisor;
  score *= 1 + Math.min(rules.playCountBoostMaximum, Math.log1p(Math.max(0, track.playCount || 0)) / rules.playCountLogDivisor);
  if (last) score *= rules.postCooldownMultiplier; // Fresh tracks stay attractive even after the cooldown expires.
  if (history.slice(0, rules.recentArtistCount).some(h => matches(h.artist, track.artist))) score *= rules.recentArtistMultiplier;
  if (history.slice(0, rules.recentAlbumCount).some(h => h.album && matches(h.album, track.album) && matches(h.artist, track.artist))) score *= rules.recentAlbumMultiplier;
  // Avoid replaying familiar transitions, not merely entire saved playlists.
  const previous = history[0]?.key;
  if (previous && (context ? context.successors.has(track.songKey) : history.some((h, i) => h.key === track.songKey && history[i + 1]?.key === previous))) score *= rules.repeatedTransitionMultiplier;
  return score;
}
class MusicRadio {
  constructor({ dataDir, random = Math.random, now = Date.now }) {
    this.file = path.join(dataDir, 'music-history.json'); this.dataDir = dataDir; this.random = random; this.now = now;
    this.history = []; this.error = '';
    this.rules = { artist: clone(DEFAULT_RULES.artist), radio: clone(DEFAULT_RULES.radio) };
    this.ruleModified = { artist: -1, radio: -1 };
    this.loadRules(true);
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
  loadRules(force = false) {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const reference = path.join(this.dataDir, RULES_REFERENCE_FILE);
      if (!fs.existsSync(reference)) fs.writeFileSync(reference, RULES_REFERENCE);
    } catch (error) {
      console.warn(`WaveDeck could not create ${RULES_REFERENCE_FILE}. ${error.message}`);
    }
    for (const mode of Object.keys(RULE_FILES)) {
      const file = path.join(this.dataDir, RULE_FILES[mode]);
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
        let stat;
        try { stat = fs.statSync(file); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          fs.writeFileSync(file, JSON.stringify(DEFAULT_RULES[mode], null, 2) + '\n');
          stat = fs.statSync(file);
        }
        if (!force && stat.mtimeMs === this.ruleModified[mode]) continue;
        this.rules[mode] = validatedRules(JSON.parse(fs.readFileSync(file, 'utf8')), DEFAULT_RULES[mode]);
        this.ruleModified[mode] = stat.mtimeMs;
      } catch (error) {
        this.rules[mode] = clone(DEFAULT_RULES[mode]);
        this.ruleModified[mode] = -1;
        console.warn(`WaveDeck could not read ${RULE_FILES[mode]}; using built-in defaults. ${error.message}`);
      }
    }
  }
  choose(tracks, seed, mode, excluded = new Set()) {
    if (this.error) throw new Error(this.error);
    this.loadRules();
    const rules = this.rules[mode] || this.rules.radio;
    const now = this.now();
    const context = { last: new Map(), successors: new Set() };
    this.history.forEach((h, i) => {
      if (!context.last.has(h.key)) context.last.set(h.key, h);
      if (this.history[i + 1]?.key === this.history[0]?.key) context.successors.add(h.key);
    });
    let candidates = tracks.filter(t => !excluded.has(t.id)).map(track => ({ track, score: weight(track, seed, mode, this.history, now, context, rules) })).filter(c => c.score > 0);
    const related = candidates.filter(({ track }) => matches(track.artist, radioArtist(seed)) ||
      overlaps(track.genres, seed.genres) || overlaps(track.artists, seed.artists) ||
      overlaps(seed.similarArtists, [track.artist]) || overlaps(track.similarArtists, [seed.artist]) || overlaps(track.moods, seed.moods));
    // Unrelated tracks must not overwhelm a smaller relevant pool by sheer count.
    // Broaden only after the available related pool is exhausted by cooldowns.
    if (related.length) {
      if (rules.unrelatedTrackMultiplier > 0) {
        const relatedIds = new Set(related.map(candidate => candidate.track.id));
        candidates = candidates.map(candidate => relatedIds.has(candidate.track.id)
          ? candidate
          : { ...candidate, score: candidate.score * rules.unrelatedTrackMultiplier }).filter(candidate => candidate.score > 0);
      } else candidates = related;
    }
    const previous = this.history[0]?.key;
    const pastSuccessor = this.history.find((h, i) => this.history[i + 1]?.key === previous)?.key;
    const freshTransitions = candidates.filter(c => c.track.songKey !== pastSuccessor);
    if (freshTransitions.length) candidates = freshTransitions;
    const selectionExponent = rules.selectionRandomness;
    const weightedCandidates = candidates.map(candidate => ({ ...candidate, score: candidate.score ** selectionExponent }));
    let remaining = this.random() * weightedCandidates.reduce((sum, c) => sum + c.score, 0);
    for (const candidate of weightedCandidates) { remaining -= candidate.score; if (remaining < 0) return candidate.track; }
    return weightedCandidates.at(-1)?.track || null;
  }
}
module.exports = { MusicRadio, weight, COOLDOWN, DEFAULT_RULES, RULE_FILES };
