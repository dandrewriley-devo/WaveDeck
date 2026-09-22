const fs = require('fs');
const path = require('path');
const { normalize, radioArtist } = require('./music-tags');
const RULE_FILES = { artist: 'artist-radio-rules.json', radio: 'song-radio-rules.json' };
const RULES_REFERENCE_FILE = 'music-radio-rules-reference.txt';
const DEFAULT_RULES = {
  artist: {
    version: 4, repeatCooldownMinutes: 120, excludeRatingAtOrBelow: 2, lowRatingMaximum: 4,
    lowRatingMultiplier: 0.08, ratingBaseMultiplier: 0.8, ratingStepMultiplier: 0.08,
    artistFocusPercent: 50, featuredArtistWeight: 4, genreWeight: 5, similarArtistWeight: 6,
    moodWeight: 2, eraWeight: 2, eraYearRange: 10, songPopularityPercent: 50,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1,
    playCountBoostMaximum: 0.15,
    playCountLogDivisor: 40, postCooldownMultiplier: 0.55, recentArtistCount: 3,
    recentArtistMultiplier: 0.18, recentAlbumCount: 5, recentAlbumMultiplier: 0.5,
    repeatedTransitionMultiplier: 0.02
  },
  radio: {
    version: 4, repeatCooldownMinutes: 120, excludeRatingAtOrBelow: 2, lowRatingMaximum: 4,
    lowRatingMultiplier: 0.08, ratingBaseMultiplier: 0.8, ratingStepMultiplier: 0.08,
    artistFocusPercent: 50, featuredArtistWeight: 4, genreWeight: 5, similarArtistWeight: 6,
    moodWeight: 2, eraWeight: 2, eraYearRange: 10, songPopularityPercent: 50,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1,
    playCountBoostMaximum: 0.15,
    playCountLogDivisor: 40, postCooldownMultiplier: 0.55, recentArtistCount: 3,
    recentArtistMultiplier: 0.18, recentAlbumCount: 5, recentAlbumMultiplier: 0.5,
    repeatedTransitionMultiplier: 0.02
  }
};
const COOLDOWN = DEFAULT_RULES.artist.repeatCooldownMinutes * 60 * 1000;
const ARTIST_FOCUS_STOPS = [0, 10, 25, 50, 70, 85, 100];
const SONG_POPULARITY_STOPS = [0, 10, 25, 50, 70, 85, 100];
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
  songPopularityPercent: { min: 0, max: 100, integer: true, stops: SONG_POPULARITY_STOPS },
  unrelatedTrackMultiplier: { min: 0, max: 1 },
  selectionRandomness: { min: 0, max: 10 },
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
`songPopularityPercent (0, 10, 25, 50, 70, 85, 100): How much the Last.fm 0–100 song-popularity score matters. Missing popularity data is neutral.\n` +
`eraYearRange (1–1000): How far apart release years may be and still feel like the same era.\n` +
`unrelatedTrackMultiplier (0–1): 0 stays with related music when available; 1 lets unrelated music compete normally.\n` +
`selectionRandomness (0–10): Lower values make picks more surprising; higher values favor the strongest matches.\n` +
`excludeRatingAtOrBelow and lowRatingMaximum (0–10): Decide which low ratings are skipped or made rare.\n` +
`lowRatingMultiplier, postCooldownMultiplier, recentArtistMultiplier, recentAlbumMultiplier, repeatedTransitionMultiplier (0–1): 0 is the strongest hold-back; 1 is no extra hold-back.\n` +
`recentArtistCount and recentAlbumCount (0–100): How far back radio looks when preventing clumps.\n` +
`ratingBaseMultiplier, ratingStepMultiplier, playCountBoostMaximum, playCountLogDivisor: Fine-tune rating and listening-history boosts.\n`;
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
function legacySongPopularity(value) {
  const maximum = Math.max(0, Number(value?.popularityMaximum) || 0);
  const divisor = Math.max(1, Number(value?.popularityDivisor) || 1);
  const oldMaximumBoost = Math.min(maximum, 100) / divisor;
  return SONG_POPULARITY_STOPS.reduce((nearest, stop) => Math.abs(stop - oldMaximumBoost * 100) < Math.abs(nearest - oldMaximumBoost * 100) ? stop : nearest, SONG_POPULARITY_STOPS[0]);
}
function nearestSongPopularityStop(value) {
  return SONG_POPULARITY_STOPS.reduce((nearest, stop) => Math.abs(stop - value) < Math.abs(nearest - value) ? stop : nearest, SONG_POPULARITY_STOPS[0]);
}
function validatedRules(value, defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clone(defaults);
  const result = clone(defaults);
  const oldVersion = Number(value.version) || 1;
  if (oldVersion < 3) result.artistFocusPercent = legacyArtistFocus(value);
  if (oldVersion < 4) result.songPopularityPercent = legacySongPopularity(value);
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
      result[key] = key === 'artistFocusPercent' ? nearestArtistFocusStop(rounded)
        : key === 'songPopularityPercent' ? nearestSongPopularityStop(rounded) : rounded;
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
function scoreTrack(track, seed, mode, history, now, context = null, rules = DEFAULT_RULES[mode] || DEFAULT_RULES.radio) {
  // 1–2 / 10 = one star; 3–4 / 10 = two stars. Unrated is neutral.
  if (track.rating !== null && track.rating <= rules.excludeRatingAtOrBelow) {
    return { score: 0, excluded: 'rating', additions: [], multipliers: [] };
  }
  const last = context ? context.last.get(track.songKey) : history.find(h => h.key === track.songKey);
  if (last && now - last.at < rules.repeatCooldownMinutes * 60 * 1000) {
    return { score: 0, excluded: 'cooldown', additions: [], multipliers: [] };
  }
  let score = 1;
  const additions = [];
  const multipliers = [];
  if (overlaps(track.artists, [radioArtist(seed)])) {
    score += rules.featuredArtistWeight;
    additions.push({ label: 'Seed or featured artist match', amount: rules.featuredArtistWeight });
  }
  if (overlaps(track.genres, seed.genres)) {
    score += rules.genreWeight;
    additions.push({ label: 'Genre match', amount: rules.genreWeight });
  }
  if (overlaps(track.similarArtists, [seed.artist]) || overlaps(seed.similarArtists, [track.artist])) {
    score += rules.similarArtistWeight;
    additions.push({ label: 'Related artist match', amount: rules.similarArtistWeight });
  }
  if (overlaps(track.moods, seed.moods)) {
    score += rules.moodWeight;
    additions.push({ label: 'Mood match', amount: rules.moodWeight });
  }
  if (seed.year && track.year) {
    const amount = Math.max(0, rules.eraWeight - Math.abs(seed.year - track.year) / rules.eraYearRange);
    if (amount > 0) {
      score += amount;
      additions.push({ label: 'Release-year match', amount });
    }
  }
  // Bounded preference boosts preserve room for deep cuts and unrated songs.
  const ratingMultiplier = track.rating === null ? 1 : track.rating <= rules.lowRatingMaximum
    ? rules.lowRatingMultiplier
    : rules.ratingBaseMultiplier + track.rating * rules.ratingStepMultiplier;
  score *= ratingMultiplier;
  multipliers.push({ label: 'Rating', value: ratingMultiplier, source: track.rating === null ? 'Unrated' : `${track.rating}/10` });
  const rawPopularity = track.popularity;
  const parsedPopularity = Number(rawPopularity);
  const popularity = rawPopularity === null || rawPopularity === undefined || rawPopularity === "" || !Number.isFinite(parsedPopularity)
    ? null
    : Math.min(100, Math.max(0, parsedPopularity));
  const popularityMultiplier = 1 + ((popularity || 0) / 100) * (rules.songPopularityPercent / 100);
  score *= popularityMultiplier;
  multipliers.push({ label: 'Song Popularity', value: popularityMultiplier, source: popularity === null ? 'Last.fm score missing' : `${popularity}/100` });
  const playCountMultiplier = 1 + Math.min(rules.playCountBoostMaximum, Math.log1p(Math.max(0, track.playCount || 0)) / rules.playCountLogDivisor);
  score *= playCountMultiplier;
  multipliers.push({ label: 'Play count', value: playCountMultiplier, source: String(Number(track.playCount) || 0) });
  if (last) {
    score *= rules.postCooldownMultiplier; // Fresh tracks stay attractive even after the cooldown expires.
    multipliers.push({ label: 'After cooldown', value: rules.postCooldownMultiplier, source: 'Heard before' });
  }
  if (history.slice(0, rules.recentArtistCount).some(h => matches(h.artist, track.artist))) {
    score *= rules.recentArtistMultiplier;
    multipliers.push({ label: 'Recent artist spacing', value: rules.recentArtistMultiplier });
  }
  if (history.slice(0, rules.recentAlbumCount).some(h => h.album && matches(h.album, track.album) && matches(h.artist, track.artist))) {
    score *= rules.recentAlbumMultiplier;
    multipliers.push({ label: 'Recent album spacing', value: rules.recentAlbumMultiplier });
  }
  // Avoid replaying familiar transitions, not merely entire saved playlists.
  const previous = history[0]?.key;
  if (previous && (context ? context.successors.has(track.songKey) : history.some((h, i) => h.key === track.songKey && history[i + 1]?.key === previous))) {
    score *= rules.repeatedTransitionMultiplier;
    multipliers.push({ label: 'Repeated handoff spacing', value: rules.repeatedTransitionMultiplier });
  }
  return { score, excluded: '', additions, multipliers, popularity };
}
function weight(track, seed, mode, history, now, context = null, rules = DEFAULT_RULES[mode] || DEFAULT_RULES.radio) {
  return scoreTrack(track, seed, mode, history, now, context, rules).score;
}
class MusicRadio {
  constructor({ dataDir, random = Math.random, now = Date.now, onDecision = () => {} }) {
    this.file = path.join(dataDir, 'music-history.json'); this.dataDir = dataDir; this.random = random; this.now = now;
    this.onDecision = typeof onDecision === 'function' ? onDecision : () => {};
    this.history = []; this.error = '';
    this.lastDecision = null;
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
  getLastDecision() { return this.lastDecision ? clone(this.lastDecision) : null; }
  #rememberDecision(decision) {
    this.lastDecision = clone(decision);
    try { this.onDecision(this.getLastDecision()); } catch (error) { console.warn(`WaveDeck could not publish a radio log entry. ${error.message}`); }
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
    const availableTracks = tracks.filter(t => !excluded.has(t.id));
    const scored = availableTracks.map(track => ({ track, ...scoreTrack(track, seed, mode, this.history, now, context, rules) }));
    const ratingExcluded = scored.filter(candidate => candidate.excluded === 'rating').length;
    const cooldownExcluded = scored.filter(candidate => candidate.excluded === 'cooldown').length;
    let candidates = scored.filter(candidate => candidate.score > 0);
    const eligibleBeforeRelated = candidates.length;
    const related = candidates.filter(({ track }) => matches(track.artist, radioArtist(seed)) ||
      overlaps(track.genres, seed.genres) || overlaps(track.artists, seed.artists) ||
      overlaps(seed.similarArtists, [track.artist]) || overlaps(track.similarArtists, [seed.artist]) || overlaps(track.moods, seed.moods));
    // Unrelated tracks must not overwhelm a smaller relevant pool by sheer count.
    // Broaden only after the available related pool is exhausted by cooldowns.
    const relatedCount = related.length;
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
    let artistFocusOutcome = 'No seed-artist preference';
    let artistFocusRoll = null;
    if (seedCandidates.length && rules.artistFocusPercent > 0) {
      if (rules.artistFocusPercent >= 100) {
        candidates = seedCandidates;
        artistFocusOutcome = 'Seed artist required (Always)';
      } else if (!otherCandidates.length) {
        candidates = seedCandidates;
        artistFocusOutcome = 'Seed artist used (no other eligible choice)';
      } else {
        artistFocusRoll = this.random();
        if (artistFocusRoll < rules.artistFocusPercent / 100) {
          candidates = seedCandidates;
          artistFocusOutcome = 'Seed artist chosen by Artist Focus';
        } else {
          candidates = otherCandidates;
          artistFocusOutcome = 'Another artist chosen by Artist Focus';
        }
      }
    } else {
      candidates = preferFreshTransition(candidates);
      if (!seedCandidates.length && rules.artistFocusPercent > 0) artistFocusOutcome = 'No eligible seed-artist track; used related music';
    }
    const selectionExponent = rules.selectionRandomness;
    const weightedCandidates = candidates.map(candidate => ({ ...candidate, baseScore: candidate.score, score: candidate.score ** selectionExponent }));
    const totalWeightedScore = weightedCandidates.reduce((sum, c) => sum + c.score, 0);
    const selectionRoll = this.random();
    let remaining = selectionRoll * totalWeightedScore;
    const picked = weightedCandidates.find(candidate => {
      remaining -= candidate.score;
      return remaining < 0;
    }) || weightedCandidates.at(-1) || null;
    const selected = picked?.track || null;
    this.#rememberDecision({
      at: new Date(now).toISOString(),
      mode,
      seed: { title: String(seed?.title || ''), artist: String(seed?.artist || ''), album: String(seed?.album || '') },
      settings: {
        artistFocusPercent: rules.artistFocusPercent,
        genreWeight: rules.genreWeight,
        songPopularityPercent: rules.songPopularityPercent,
        unrelatedTrackMultiplier: rules.unrelatedTrackMultiplier,
        selectionRandomness: rules.selectionRandomness
      },
      counts: {
        totalTracks: tracks.length,
        skippedByPlaybackError: excluded.size,
        skippedForRating: ratingExcluded,
        skippedForCooldown: cooldownExcluded,
        eligible: eligibleBeforeRelated,
        related: relatedCount,
        seedArtist: seedCandidates.length,
        otherArtists: otherCandidates.length,
        finalPool: weightedCandidates.length
      },
      artistFocus: { seedArtist, targetPercent: rules.artistFocusPercent, roll: artistFocusRoll, outcome: artistFocusOutcome },
      selectionRoll,
      selected: selected ? {
        title: String(selected.title || ''), artist: String(selected.artist || ''), album: String(selected.album || ''),
        popularity: picked.popularity, rating: selected.rating, playCount: Number(selected.playCount) || 0,
        scoreBeforeRandomness: picked.baseScore,
        scoreAfterRandomness: picked.score,
        additions: picked.additions,
        multipliers: picked.multipliers
      } : null,
      reason: selected ? `${artistFocusOutcome}; picked from ${weightedCandidates.length} eligible track${weightedCandidates.length === 1 ? '' : 's'}.` : 'No eligible song is available yet.'
    });
    return selected;
  }
}
module.exports = { MusicRadio, weight, scoreTrack, COOLDOWN, DEFAULT_RULES, RULE_FILES, RULE_MINIMUMS, RULE_MAXIMUMS, RULE_SPECS, ARTIST_FOCUS_STOPS, SONG_POPULARITY_STOPS };
