const fs = require('fs');
const path = require('path');
const { normalize, radioArtist } = require('./music-tags');
const RULE_FILES = { artist: 'artist-radio-rules.json', radio: 'song-radio-rules.json' };
const RULES_REFERENCE_FILE = 'music-radio-rules-reference.txt';
const DEFAULT_RULES = {
  artist: {
    version: 3, repeatCooldownMinutes: 120, excludeRatingAtOrBelow: 2, lowRatingMaximum: 4,
    lowRatingMultiplier: 0.08, ratingBaseMultiplier: 0.8, ratingStepMultiplier: 0.08,
    artistFocusPercent: 50, featuredArtistWeight: 4, genreWeight: 5, similarArtistWeight: 6,
    moodWeight: 2, eraWeight: 2, eraYearRange: 10, favoriteMultiplier: 1.25,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1,
    popularityMaximum: 100, popularityDivisor: 250, playCountBoostMaximum: 0.15,
    playCountLogDivisor: 40, postCooldownMultiplier: 0.55, recentArtistCount: 3,
    recentArtistMultiplier: 0.18, recentAlbumCount: 5, recentAlbumMultiplier: 0.5,
    repeatedTransitionMultiplier: 0.02
  },
  radio: {
    version: 3, repeatCooldownMinutes: 120, excludeRatingAtOrBelow: 2, lowRatingMaximum: 4,
    lowRatingMultiplier: 0.08, ratingBaseMultiplier: 0.8, ratingStepMultiplier: 0.08,
    artistFocusPercent: 50, featuredArtistWeight: 4, genreWeight: 5, similarArtistWeight: 6,
    moodWeight: 2, eraWeight: 2, eraYearRange: 10, favoriteMultiplier: 1.25,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1,
    popularityMaximum: 100, popularityDivisor: 250, playCountBoostMaximum: 0.15,
    playCountLogDivisor: 40, postCooldownMultiplier: 0.55, recentArtistCount: 3,
    recentArtistMultiplier: 0.18, recentAlbumCount: 5, recentAlbumMultiplier: 0.5,
    repeatedTransitionMultiplier: 0.02
  }
};
const COOLDOWN = DEFAULT_RULES.artist.repeatCooldownMinutes * 60 * 1000;
const ARTIST_FOCUS_STOPS = [0, 10, 25, 50, 70, 85, 100];
// These are the actual, safe working ranges for each rule.  Do not use a
// catch-all maximum: several rules are multipliers where a large number means
// the opposite of the plain-English slider label (for example artist spacing).
const RULE_SPECS = {
  repeatCooldownMinutes: { min: 120, max: 10080, integer: true },
  excludeRatingAtOrBelow: { min: 0, max: 10, integer: true },
  lowRatingMaximum: { min: 0, max: 10, integer: true },
  lowRatingMultiplier: { min: 0, max: 1 },
  ratingBaseMultiplier: { min: 0, max: 10000 },
  ratingStepMultiplier: { min: 0, max: 10000 },
  artistFocusPercent: { min: 0, max: 100, integer: true, stops: ARTIST_FOCUS_STOPS },
  featuredArtistWeight: { min: 0, max: 10000 },
  genreWeight: { min: 0, max: 10000 },
  similarArtistWeight: { min: 0, max: 10000 },
  moodWeight: { min: 0, max: 10000 },
  eraWeight: { min: 0, max: 10000 },
  eraYearRange: { min: 1, max: 1000, integer: true },
  favoriteMultiplier: { min: 0, max: 10000 },
  unrelatedTrackMultiplier: { min: 0, max: 1 },
  selectionRandomness: { min: 0, max: 10 },
  popularityMaximum: { min: 0, max: 10000 },
  popularityDivisor: { min: 1, max: 10000 },
  playCountBoostMaximum: { min: 0, max: 10 },
  playCountLogDivisor: { min: 1, max: 10000 },
  postCooldownMultiplier: { min: 0, max: 1 },
  recentArtistCount: { min: 0, max: 100, integer: true },
  recentArtistMultiplier: { min: 0, max: 1 },
  recentAlbumCount: { min: 0, max: 100, integer: true },
  recentAlbumMultiplier: { min: 0, max: 1 },
  repeatedTransitionMultiplier: { min: 0, max: 1 }
};
const RULE_MINIMUMS = Object.fromEntries(Object.entries(RULE_SPECS).map(([key, spec]) => [key, spec.min]));
const RULE_MAXIMUMS = Object.fromEntries(Object.entries(RULE_SPECS).map(([key, spec]) => [key, spec.max]));
const LEGACY_BROKEN_SLIDERS = new Set([
  'lowRatingMultiplier', 'unrelatedTrackMultiplier', 'postCooldownMultiplier',
  'recentArtistCount', 'recentArtistMultiplier', 'recentAlbumCount',
  'recentAlbumMultiplier', 'repeatedTransitionMultiplier'
]);
const RULES_REFERENCE = `WaveDeck Music Radio Rules\n\n` +
`WaveDeck's Settings → Advanced tab is the normal way to tune Artist Radio and Song Radio. The sliders save these files automatically.\n\n` +
`artist-radio-rules.json controls Artist Radio.\n` +
`song-radio-rules.json controls Song Radio.\n\n` +
`If you edit a file yourself, save it and WaveDeck uses the new value before choosing its next radio song. Invalid files use built-in defaults until fixed.\n\n` +
`The Settings sliders are the recommended way to tune radio. They use safe limits and plain-English labels.\n\n` +
`repeatCooldownMinutes (120–10080): Minimum wait before the same song can return.\n` +
`artistFocusPercent (0, 10, 25, 50, 70, 85, 100): How often radio tries to play the seed artist. At 100, it always chooses an eligible seed-artist track and falls back to related music only when none is available.\n` +
`featuredArtistWeight, genreWeight, similarArtistWeight, moodWeight, eraWeight (0–10000): Higher values make that connection matter more.\n` +
`eraYearRange (1–1000): How far apart release years may be and still feel like the same era.\n` +
`unrelatedTrackMultiplier (0–1): 0 stays with related music when available; 1 lets unrelated music compete normally.\n` +
`selectionRandomness (0–10): Lower values make picks more surprising; higher values favor the strongest matches.\n` +
`excludeRatingAtOrBelow and lowRatingMaximum (0–10): Decide which low ratings are skipped or made rare.\n` +
`lowRatingMultiplier, postCooldownMultiplier, recentArtistMultiplier, recentAlbumMultiplier, repeatedTransitionMultiplier (0–1): 0 is the strongest hold-back; 1 is no extra hold-back.\n` +
`recentArtistCount and recentAlbumCount (0–100): How far back radio looks when preventing clumps.\n` +
`ratingBaseMultiplier, ratingStepMultiplier, favoriteMultiplier, popularityMaximum, popularityDivisor, playCountBoostMaximum, playCountLogDivisor: Fine-tune preference and listening-history boosts.\n`;
const matches = (a, b) => Boolean(a && b && normalize(a) === normalize(b));
const overlaps = (a = [], b = []) => a.some(x => b.some(y => matches(x, y)));
const clone = value => JSON.parse(JSON.stringify(value));
function legacyArtistFocus(value) {
  const oldWeight = Number(value?.sameArtistWeight);
  if (!Number.isFinite(oldWeight) || oldWeight <= 0) return 0;
  if (oldWeight < 3) return 10;
  if (oldWeight < 7) return 25;
  if (oldWeight < 25) return 50;
  if (oldWeight < 100) return 70;
  if (oldWeight < 1000) return 85;
  return 100;
}
function nearestArtistFocusStop(value) {
  return ARTIST_FOCUS_STOPS.reduce((nearest, stop) => Math.abs(stop - value) < Math.abs(nearest - value) ? stop : nearest, ARTIST_FOCUS_STOPS[0]);
}
function validatedRules(value, defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clone(defaults);
  const result = clone(defaults);
  const oldVersion = Number(value.version) || 1;
  if (oldVersion < 3) result.artistFocusPercent = legacyArtistFocus(value);
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === 'version') continue;
    const candidate = Number(value[key]);
    const spec = RULE_SPECS[key];
    if (Number.isFinite(candidate)) {
      // Version 1 exposed several 0–1 multipliers and small memory counts as
      // 0–10000 sliders. Reset only those impossible old values, rather than
      // turning "strong spacing" into "no spacing" by merely clamping to 1.
      if (oldVersion < 2 && LEGACY_BROKEN_SLIDERS.has(key) && candidate > spec.max) continue;
      const bounded = Math.min(spec.max, Math.max(spec.min, candidate));
      const rounded = spec.integer ? Math.round(bounded) : bounded;
      result[key] = key === 'artistFocusPercent' ? nearestArtistFocusStop(rounded) : rounded;
    }
  }
  return result;
}
function ruleSchema(mode) {
  const defaults = DEFAULT_RULES[mode] || DEFAULT_RULES.radio;
  return Object.fromEntries(Object.entries(defaults)
    .filter(([key]) => key !== 'version')
    .map(([key, defaultValue]) => [key, {
      defaultValue,
      ...RULE_SPECS[key]
    }]));
}
function weight(track, seed, mode, history, now, context = null, rules = DEFAULT_RULES[mode] || DEFAULT_RULES.radio) {
  // 1–2 / 10 = one star; 3–4 / 10 = two stars. Unrated is neutral.
  if (track.rating !== null && track.rating <= rules.excludeRatingAtOrBelow) return 0;
  const last = context ? context.last.get(track.songKey) : history.find(h => h.key === track.songKey);
  if (last && now - last.at < rules.repeatCooldownMinutes * 60 * 1000) return 0;
  let score = 1;
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
      if (!fs.existsSync(reference) || fs.readFileSync(reference, 'utf8') !== RULES_REFERENCE) fs.writeFileSync(reference, RULES_REFERENCE);
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
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.rules[mode] = validatedRules(saved, DEFAULT_RULES[mode]);
        if (JSON.stringify(saved) !== JSON.stringify(this.rules[mode])) {
          fs.writeFileSync(file + '.tmp', JSON.stringify(this.rules[mode], null, 2) + '\n');
          fs.renameSync(file + '.tmp', file);
          stat = fs.statSync(file);
        }
        this.ruleModified[mode] = stat.mtimeMs;
      } catch (error) {
        this.rules[mode] = clone(DEFAULT_RULES[mode]);
        this.ruleModified[mode] = -1;
        console.warn(`WaveDeck could not read ${RULE_FILES[mode]}; using built-in defaults. ${error.message}`);
      }
    }
  }
  getRules() {
    this.loadRules();
    return {
      artist: clone(this.rules.artist),
      radio: clone(this.rules.radio),
      schema: { artist: ruleSchema('artist'), radio: ruleSchema('radio') }
    };
  }
  saveRules(mode, rules) {
    const selectedMode = Object.prototype.hasOwnProperty.call(RULE_FILES, mode) ? mode : 'radio';
    const next = validatedRules(rules, DEFAULT_RULES[selectedMode]);
    const file = path.join(this.dataDir, RULE_FILES[selectedMode]);
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
    this.rules[selectedMode] = next;
    this.ruleModified[selectedMode] = fs.statSync(file).mtimeMs;
    return this.getRules();
  }
  setRule(mode, key, value) {
    const selectedMode = Object.prototype.hasOwnProperty.call(RULE_FILES, mode) ? mode : 'radio';
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_RULES[selectedMode], key) || key === 'version') {
      throw new Error('That radio setting is not available.');
    }
    const candidate = Number(value);
    if (!Number.isFinite(candidate)) throw new Error('Choose a valid radio setting value.');
    this.loadRules();
    return this.saveRules(selectedMode, { ...this.rules[selectedMode], [key]: candidate });
  }
  resetRule(mode, key) {
    const selectedMode = Object.prototype.hasOwnProperty.call(RULE_FILES, mode) ? mode : 'radio';
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_RULES[selectedMode], key) || key === 'version') {
      throw new Error('That radio setting is not available.');
    }
    this.loadRules();
    return this.saveRules(selectedMode, { ...this.rules[selectedMode], [key]: DEFAULT_RULES[selectedMode][key] });
  }
  resetRules(mode) {
    const selectedMode = Object.prototype.hasOwnProperty.call(RULE_FILES, mode) ? mode : 'radio';
    return this.saveRules(selectedMode, DEFAULT_RULES[selectedMode]);
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
    const preferFreshTransition = choices => {
      const freshTransitions = choices.filter(c => c.track.songKey !== pastSuccessor);
      return freshTransitions.length ? freshTransitions : choices;
    };
    const seedArtist = mode === 'artist' ? radioArtist(seed) : seed.artist;
    const seedCandidates = preferFreshTransition(candidates.filter(c => matches(c.track.artist, seedArtist)));
    const otherCandidates = preferFreshTransition(candidates.filter(c => !matches(c.track.artist, seedArtist)));
    // Artist Focus is intentionally a direct target rather than another
    // arbitrary score bonus. At 100, seed tracks are a hard preference; if
    // none survive rating/cooldown filters, related music resumes normally.
    if (seedCandidates.length && rules.artistFocusPercent > 0) {
      if (rules.artistFocusPercent >= 100) candidates = seedCandidates;
      else if (!otherCandidates.length || this.random() < rules.artistFocusPercent / 100) candidates = seedCandidates;
      else candidates = otherCandidates;
    } else candidates = preferFreshTransition(candidates);
    const selectionExponent = rules.selectionRandomness;
    const weightedCandidates = candidates.map(candidate => ({ ...candidate, score: candidate.score ** selectionExponent }));
    let remaining = this.random() * weightedCandidates.reduce((sum, c) => sum + c.score, 0);
    for (const candidate of weightedCandidates) { remaining -= candidate.score; if (remaining < 0) return candidate.track; }
    return weightedCandidates.at(-1)?.track || null;
  }
}
module.exports = { MusicRadio, weight, COOLDOWN, DEFAULT_RULES, RULE_FILES, RULE_MINIMUMS, RULE_MAXIMUMS, RULE_SPECS, ARTIST_FOCUS_STOPS };
