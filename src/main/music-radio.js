const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalize, radioArtist } = require('./music-tags');
const RULE_FILES = { artist: 'artist-radio-rules.json', radio: 'song-radio-rules.json' };
const RULES_REFERENCE_FILE = 'music-radio-rules-reference.txt';
const DEFAULT_RULES = {
  artist: {
    version: 6, repeatCooldownMinutes: 120, artistFocusPercent: 50, genreWeight: 5, ratingInfluence: 0,
    songPopularityPercent: 50, artistVariety: 1, albumVariety: 1, releaseYearRange: 10,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1
  },
  radio: {
    version: 6, repeatCooldownMinutes: 120, artistFocusPercent: 50, genreWeight: 5, ratingInfluence: 0,
    songPopularityPercent: 50, artistVariety: 1, albumVariety: 1, releaseYearRange: 10,
    unrelatedTrackMultiplier: 0, selectionRandomness: 1
  }
};
const COOLDOWN = DEFAULT_RULES.artist.repeatCooldownMinutes * 60 * 1000;
const ARTIST_FOCUS_STOPS = [0, 10, 25, 50, 70, 85, 100];
const SONG_POPULARITY_STOPS = [0, 10, 25, 50, 70, 85, 100];
const VARIETY_STOPS = [0, 1, 2];
const RELEASE_YEAR_STOPS = [0, 5, 10, 20, 10000];
const REPEAT_WAIT_STOPS = [120, 180, 240, 360, 480, 720, 960, 1440];
const RATING_INFLUENCE_STOPS = [0, 1, 2, 3, 4];
const RATING_MULTIPLIERS = [
  [1, 1, 1, 1, 1, 1],
  [0.25, 0.4, 0.7, 1, 1.25, 1.5],
  [0.03, 0.08, 0.2, 0.65, 1.5, 3],
  [0.005, 0.015, 0.08, 0.45, 2, 5],
  [0.001, 0.002, 0.02, 0.2, 3, 10]
];
const RELATED_ARTIST_WEIGHT = 6;
const RELEASE_YEAR_WEIGHT = 2;
const POST_COOLDOWN_MULTIPLIER = 0.75;
const HANDOFF_MEMORY_MS = 30 * 24 * 60 * 60 * 1000;
const VARIETY_RULES = {
  artist: [
    { memory: 0, multiplier: 1 },
    { memory: 4, multiplier: 0.35 },
    { memory: 10, multiplier: 0.05 }
  ],
  album: [
    { memory: 0, multiplier: 1 },
    { memory: 5, multiplier: 0.5 },
    { memory: 12, multiplier: 0.1 }
  ]
};
const RULE_SPECS = {
  repeatCooldownMinutes: { min: 120, max: 1440, integer: true, stops: REPEAT_WAIT_STOPS },
  artistFocusPercent: { min: 0, max: 100, integer: true, stops: ARTIST_FOCUS_STOPS },
  genreWeight: { min: 0, max: 10000 },
  songPopularityPercent: { min: 0, max: 100, integer: true, stops: SONG_POPULARITY_STOPS },
  artistVariety: { min: 0, max: 2, integer: true, stops: VARIETY_STOPS },
  albumVariety: { min: 0, max: 2, integer: true, stops: VARIETY_STOPS },
  releaseYearRange: { min: 0, max: 10000, integer: true, stops: RELEASE_YEAR_STOPS },
  unrelatedTrackMultiplier: { min: 0, max: 1 },
  selectionRandomness: { min: 0, max: 10 },
  ratingInfluence: { min: 0, max: 4, integer: true, stops: RATING_INFLUENCE_STOPS }
};
const RULE_MINIMUMS = Object.fromEntries(Object.entries(RULE_SPECS).map(([key, spec]) => [key, spec.min]));
const RULE_MAXIMUMS = Object.fromEntries(Object.entries(RULE_SPECS).map(([key, spec]) => [key, spec.max]));
const RULES_REFERENCE = `WaveDeck Music Radio Rules\n\n` +
`WaveDeck's Settings → Local Music tab is the normal way to tune Artist Radio and Song Radio. The sliders save these files automatically.\n\n` +
`artist-radio-rules.json controls Artist Radio.\n` +
`song-radio-rules.json controls Song Radio.\n\n` +
`If you edit a file yourself, save it and WaveDeck uses the new value before choosing its next radio song. Invalid files use built-in defaults until fixed.\n\n` +
`The Settings sliders are the recommended way to tune radio.\n\n` +
`repeatCooldownMinutes (2, 3, 4, 6, 8, 12, 16, or 24 hours): Minimum wait before the same song can return.\n` +
`artistFocusPercent (0, 10, 25, 50, 70, 85, 100): How often radio tries to play the seed artist. At 100, it always chooses an eligible seed-artist track and falls back to related music only when none is available.\n` +
`genreWeight (0–10000): Higher values make matching genre tags matter more.\n` +
`songPopularityPercent (0, 10, 25, 50, 70, 85, 100): How much the Last.fm 0–100 song-popularity score matters. Missing popularity data is neutral.\n` +
`artistVariety (0, 1, 2): How strongly radio keeps non-seed artists from bunching up.\n` +
`albumVariety (0, 1, 2): How strongly radio keeps albums from bunching up.\n` +
`releaseYearRange (same year, 5, 10, or 20 years, or no limit): How close a song's release year should be to the seed.\n` +
`unrelatedTrackMultiplier (0–1): The share of picks that may come from outside the related mix when both choices are available. 0 stays with related music; 1 always chooses outside music.\n` +
`selectionRandomness (0–10): Lower values make picks more surprising; higher values favor the strongest matches.\n\n` +
`ratingInfluence (Off, Gentle, Moderate, Strong, Dominant): How strongly read-only MP3 ratings guide radio. Unrated songs remain neutral; at Moderate, one-star songs are extremely unlikely and two-star songs are rare.\n\n` +
`Favorites, play counts, mood tags, and featured-artist bonuses are not used. Last.fm related-artist matching, a gentle post-cooldown holdback, and strict repeated-handoff avoidance are built in.\n`;
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
function nearestStop(value, stops) {
  return stops.reduce((nearest, stop) => Math.abs(stop - value) < Math.abs(nearest - value) ? stop : nearest, stops[0]);
}
function legacyVariety(value, countKey, multiplierKey) {
  const count = Number(value?.[countKey]);
  const multiplier = Number(value?.[multiplierKey]);
  if ((Number.isFinite(count) && count <= 0) || (Number.isFinite(multiplier) && multiplier >= 1)) return 0;
  if ((Number.isFinite(count) && count >= 7) || (Number.isFinite(multiplier) && multiplier <= 0.1)) return 2;
  return 1;
}
function legacyReleaseYearRange(value) {
  if (Number(value?.eraWeight) <= 0) return 10000;
  return nearestStop(Number(value?.eraYearRange) || 10, RELEASE_YEAR_STOPS.slice(0, -1));
}
function validatedRules(value, defaults) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clone(defaults);
  const result = clone(defaults);
  const oldVersion = Number(value.version) || 1;
  if (oldVersion < 3) result.artistFocusPercent = legacyArtistFocus(value);
  if (oldVersion < 4) result.songPopularityPercent = legacySongPopularity(value);
  if (oldVersion < 5) {
    result.artistVariety = legacyVariety(value, 'recentArtistCount', 'recentArtistMultiplier');
    result.albumVariety = legacyVariety(value, 'recentAlbumCount', 'recentAlbumMultiplier');
    result.releaseYearRange = legacyReleaseYearRange(value);
  }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === 'version') continue;
    const candidate = Number(value[key]);
    const spec = RULE_SPECS[key];
    if (Number.isFinite(candidate)) {
      const bounded = Math.min(spec.max, Math.max(spec.min, candidate));
      const rounded = spec.integer ? Math.round(bounded) : bounded;
      result[key] = key === 'artistFocusPercent' ? nearestArtistFocusStop(rounded)
        : key === 'songPopularityPercent' ? nearestSongPopularityStop(rounded)
          : spec.stops ? nearestStop(rounded, spec.stops) : rounded;
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
function seedArtistForMode(seed, mode) {
  return mode === 'artist' ? radioArtist(seed) : seed?.artist;
}
function isSeedArtistTrack(track, seedArtist) {
  return matches(track?.artist, seedArtist) || overlaps(track?.artists || [track?.artist], [seedArtist]);
}
function scoreTrack(track, seed, mode, history, now, context = null, rules = DEFAULT_RULES[mode] || DEFAULT_RULES.radio) {
  const last = context ? context.last.get(track.songKey) : history.find(h => h.key === track.songKey);
  if (last && now - last.at < rules.repeatCooldownMinutes * 60 * 1000) {
    return { score: 0, excluded: 'cooldown', additions: [], multipliers: [] };
  }
  let score = 1;
  const additions = [];
  const multipliers = [];
  const seedArtist = seedArtistForMode(seed, mode);
  if (overlaps(track.genres, seed.genres)) {
    score += rules.genreWeight;
    additions.push({ label: 'Genre match', amount: rules.genreWeight });
  }
  if (overlaps(track.similarArtists, [seedArtist]) || overlaps(seed.similarArtists, [track.artist])) {
    score += RELATED_ARTIST_WEIGHT;
    additions.push({ label: 'Related artist match', amount: RELATED_ARTIST_WEIGHT });
  }
  const yearDifference = seed.year && track.year ? Math.abs(seed.year - track.year) : null;
  if (yearDifference !== null && rules.releaseYearRange < 10000 && yearDifference <= rules.releaseYearRange) {
    const amount = rules.releaseYearRange === 0
      ? RELEASE_YEAR_WEIGHT
      : RELEASE_YEAR_WEIGHT * (1 - yearDifference / (rules.releaseYearRange + 1));
    score += amount;
    additions.push({ label: 'Release-year range match', amount });
  }
  const rawPopularity = track.popularity;
  const parsedPopularity = Number(rawPopularity);
  const popularity = rawPopularity === null || rawPopularity === undefined || rawPopularity === "" || !Number.isFinite(parsedPopularity)
    ? null
    : Math.min(100, Math.max(0, parsedPopularity));
  const popularityMultiplier = 1 + ((popularity || 0) / 100) * (rules.songPopularityPercent / 100);
  score *= popularityMultiplier;
  multipliers.push({ label: 'Song Popularity', value: popularityMultiplier, source: popularity === null ? 'Last.fm score missing' : `${popularity}/100` });
  const rawRating = track.ratingStars ?? (track.rating === null || track.rating === undefined ? null : Number(track.rating) / 2);
  const rating = Number.isFinite(Number(rawRating)) && rawRating !== null ? Math.max(0, Math.min(5, Number(rawRating))) : null;
  const influence = Math.max(0, Math.min(4, Math.round(Number(rules.ratingInfluence) || 0)));
  let ratingMultiplier = 1;
  if (rating !== null && influence > 0) {
    const lower = Math.floor(rating);
    const upper = Math.min(5, lower + 1);
    const fraction = rating - lower;
    const table = RATING_MULTIPLIERS[influence];
    ratingMultiplier = table[lower] * (1 - fraction) + table[upper] * fraction;
    score *= ratingMultiplier;
  }
  multipliers.push({ label: 'MP3 Rating', value: ratingMultiplier, source: rating === null ? 'No rating; neutral' : `${rating}/5 stars${track.ratingSource ? ` (${track.ratingSource})` : ''}` });
  if (last) {
    score *= POST_COOLDOWN_MULTIPLIER;
    multipliers.push({ label: 'After repeat wait', value: POST_COOLDOWN_MULTIPLIER, source: 'Heard before' });
  }
  const artistVariety = VARIETY_RULES.artist[rules.artistVariety] || VARIETY_RULES.artist[1];
  if (!isSeedArtistTrack(track, seedArtist) && artistVariety.memory > 0 &&
    history.slice(0, artistVariety.memory).some(h => matches(h.artist, track.artist))) {
    score *= artistVariety.multiplier;
    multipliers.push({ label: 'Artist Variety', value: artistVariety.multiplier });
  }
  const albumVariety = VARIETY_RULES.album[rules.albumVariety] || VARIETY_RULES.album[1];
  if (albumVariety.memory > 0 && history.slice(0, albumVariety.memory).some(h => h.album && matches(h.album, track.album))) {
    score *= albumVariety.multiplier;
    multipliers.push({ label: 'Album Variety', value: albumVariety.multiplier });
  }
  return { score, excluded: '', additions, multipliers, popularity, repeatedHandoff: Boolean(context?.successors.has(track.songKey)) };
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
  choose(tracks, seed, mode, excluded = new Set(), selectionTrigger = 'next') {
    if (this.error) throw new Error(this.error);
    this.loadRules();
    const rules = this.rules[mode] || this.rules.radio;
    const now = this.now();
    const context = { last: new Map(), successors: new Set() };
    this.history.forEach((h, i) => {
      if (!context.last.has(h.key)) context.last.set(h.key, h);
      // History runs newest to oldest. If an older copy of the current song
      // was followed by a track, that track is a handoff we should avoid now.
      if (i > 0 && now - h.at <= HANDOFF_MEMORY_MS && h.key === this.history[0]?.key) context.successors.add(this.history[i - 1].key);
    });
    const availableTracks = tracks.filter(t => !excluded.has(t.id));
    const scored = availableTracks.map(track => ({ track, ...scoreTrack(track, seed, mode, this.history, now, context, rules) }));
    const cooldownExcluded = scored.filter(candidate => candidate.excluded === 'cooldown').length;
    let candidates = scored.filter(candidate => candidate.score > 0);
    const freshHandoffs = candidates.filter(candidate => !candidate.repeatedHandoff);
    const handoffExcluded = freshHandoffs.length ? candidates.length - freshHandoffs.length : 0;
    if (freshHandoffs.length) candidates = freshHandoffs;
    const eligibleBeforeRelated = candidates.length;
    const seedArtist = seedArtistForMode(seed, mode);
    const related = candidates.filter(({ track }) => isSeedArtistTrack(track, seedArtist) ||
      overlaps(track.genres, seed.genres) || overlaps(track.artists, seed.artists) ||
      overlaps(seed.similarArtists, [track.artist]) || overlaps(track.similarArtists, [seedArtist]));
    const relatedCount = related.length;
    const seedCandidates = candidates.filter(c => isSeedArtistTrack(c.track, seedArtist));
    const otherCandidates = candidates.filter(c => !isSeedArtistTrack(c.track, seedArtist));
    // Artist Focus is intentionally a direct target rather than another
    // arbitrary score bonus. At 100, seed tracks are a hard preference; if
    // none survive repeat protection, related music resumes normally.
    let artistFocusOutcome = 'No seed-artist preference';
    let artistFocusRoll = null;
    let artistFocusUsed = false;
    if (seedCandidates.length && rules.artistFocusPercent > 0) {
      if (rules.artistFocusPercent >= 100) {
        candidates = seedCandidates;
        artistFocusUsed = true;
        artistFocusOutcome = 'Seed artist required (Always)';
      } else if (!otherCandidates.length) {
        candidates = seedCandidates;
        artistFocusUsed = true;
        artistFocusOutcome = 'Seed artist used (no other eligible choice)';
      } else {
        artistFocusRoll = this.random();
        if (artistFocusRoll < rules.artistFocusPercent / 100) {
          candidates = seedCandidates;
          artistFocusUsed = true;
          artistFocusOutcome = 'Seed artist chosen by Artist Focus';
        } else {
          candidates = otherCandidates;
          artistFocusOutcome = 'Another artist chosen by Artist Focus';
        }
      }
    } else {
      if (!seedCandidates.length && rules.artistFocusPercent > 0) artistFocusOutcome = 'No eligible seed-artist track; used related music';
    }
    const relatedIds = new Set(related.map(candidate => candidate.track.id));
    const laneCandidates = candidates;
    const relatedLane = laneCandidates.filter(candidate => relatedIds.has(candidate.track.id));
    const outsideLane = laneCandidates.filter(candidate => !relatedIds.has(candidate.track.id));
    let lane = artistFocusUsed ? 'seed-artist' : 'related';
    let outsideRoll = null;
    if (!artistFocusUsed && relatedLane.length && outsideLane.length) {
      outsideRoll = this.random();
      if (outsideRoll < rules.unrelatedTrackMultiplier) { candidates = outsideLane; lane = 'outside'; }
      else { candidates = relatedLane; lane = 'related'; }
    } else if (!artistFocusUsed && outsideLane.length && !relatedLane.length) { candidates = outsideLane; lane = 'outside'; }
    else if (!artistFocusUsed) { candidates = relatedLane; lane = 'related'; }
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
    const diagnosticCandidate = candidate => ({
      diagnosticId: crypto.createHash('sha256').update(String(candidate.track?.songKey || candidate.track?.id || '')).digest('hex').slice(0, 16),
      title: String(candidate.track?.title || ''),
      artist: String(candidate.track?.artist || ''),
      album: String(candidate.track?.album || ''),
      year: Number(candidate.track?.year) || null,
      genres: Array.isArray(candidate.track?.genres) ? candidate.track.genres.slice(0, 8).map(String) : [],
      popularity: candidate.popularity ?? null,
      popularitySource: candidate.track?.lastFm?.source || 'tag',
      popularityUpdatedAt: candidate.track?.lastFm?.updatedAt || '',
      scoreBeforeRandomness: candidate.baseScore,
      scoreAfterRandomness: candidate.score,
      additions: candidate.additions,
      multipliers: candidate.multipliers
    });
    const rankedCandidates = [...weightedCandidates]
      .sort((a, b) => b.score - a.score || b.baseScore - a.baseScore)
      .slice(0, 8);
    const selectedRank = selected
      ? [...weightedCandidates].sort((a, b) => b.score - a.score || b.baseScore - a.baseScore)
        .findIndex(candidate => candidate.track === selected) + 1
      : null;
    const laneWeight = items => items.reduce((sum, candidate) => sum + (candidate.score ** selectionExponent), 0);
    this.#rememberDecision({
      at: new Date(now).toISOString(),
      mode,
      selectionTrigger,
      seed: {
        diagnosticId: crypto.createHash('sha256').update(String(seed?.songKey || seed?.id || '')).digest('hex').slice(0, 16),
        title: String(seed?.title || ''), artist: String(seed?.artist || ''), album: String(seed?.album || ''),
        year: Number(seed?.year) || null,
        genres: Array.isArray(seed?.genres) ? seed.genres.slice(0, 8).map(String) : []
      },
      settings: {
        artistFocusPercent: rules.artistFocusPercent,
        genreWeight: rules.genreWeight,
        songPopularityPercent: rules.songPopularityPercent,
        artistVariety: rules.artistVariety,
        albumVariety: rules.albumVariety,
        releaseYearRange: rules.releaseYearRange,
        repeatCooldownMinutes: rules.repeatCooldownMinutes,
        unrelatedTrackMultiplier: rules.unrelatedTrackMultiplier,
        selectionRandomness: rules.selectionRandomness
      },
      counts: {
        totalTracks: tracks.length,
        skippedByPlaybackError: excluded.size,
        skippedForCooldown: cooldownExcluded,
        skippedForHandoff: handoffExcluded,
        eligible: eligibleBeforeRelated,
        related: relatedCount,
        seedArtist: seedCandidates.length,
        otherArtists: otherCandidates.length,
        finalPool: weightedCandidates.length,
        relatedLane: relatedLane.length,
        outsideLane: outsideLane.length
      },
      artistFocus: { seedArtist, targetPercent: rules.artistFocusPercent, roll: artistFocusRoll, outcome: artistFocusOutcome },
      outsideVariety: { targetPercent: Math.round(rules.unrelatedTrackMultiplier * 100), roll: outsideRoll, lane },
      selectionRoll,
      selected: selected ? {
        diagnosticId: crypto.createHash('sha256').update(String(selected.songKey || selected.id || '')).digest('hex').slice(0, 16),
        title: String(selected.title || ''), artist: String(selected.artist || ''), album: String(selected.album || ''),
        year: Number(selected.year) || null,
        genres: Array.isArray(selected.genres) ? selected.genres.slice(0, 8).map(String) : [],
        popularity: picked.popularity,
        popularitySource: selected.lastFm?.source || 'tag', popularityUpdatedAt: selected.lastFm?.updatedAt || '',
        scoreBeforeRandomness: picked.baseScore,
        scoreAfterRandomness: picked.score,
        additions: picked.additions,
        multipliers: picked.multipliers
      } : null,
      diagnostics: {
        recentHistory: this.history.slice(0, 12).map(entry => ({
          diagnosticId: crypto.createHash('sha256').update(String(entry.key || '')).digest('hex').slice(0, 16),
          artist: String(entry.artist || ''), album: String(entry.album || ''), at: new Date(entry.at).toISOString()
        })),
        selectedRank,
        totalWeightedScore,
        lanes: {
          seedArtist: { candidates: seedCandidates.length, weightedScore: laneWeight(seedCandidates) },
          related: { candidates: relatedLane.length, weightedScore: laneWeight(relatedLane) },
          outside: { candidates: outsideLane.length, weightedScore: laneWeight(outsideLane) },
          chosen: lane
        },
        popularity: {
          selectedSource: selected?.lastFm?.source || 'tag',
          selectedUpdatedAt: selected?.lastFm?.updatedAt || '',
          finalPoolLastFm: weightedCandidates.filter(candidate => candidate.track?.lastFm?.source === 'lastfm').length,
          finalPoolTag: weightedCandidates.filter(candidate => candidate.track?.lastFm?.source === 'tag').length
        },
        topFinalCandidates: rankedCandidates.map(diagnosticCandidate)
      },
      reason: selected ? `${artistFocusOutcome}; picked from ${weightedCandidates.length} eligible track${weightedCandidates.length === 1 ? '' : 's'}.` : 'No eligible song is available yet.'
    });
    return selected;
  }
}
module.exports = { MusicRadio, weight, scoreTrack, COOLDOWN, HANDOFF_MEMORY_MS, DEFAULT_RULES, RULE_FILES, RULE_MINIMUMS, RULE_MAXIMUMS, RULE_SPECS, ARTIST_FOCUS_STOPS, SONG_POPULARITY_STOPS, RATING_INFLUENCE_STOPS };
