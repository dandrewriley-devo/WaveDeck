const fs = require('fs');
const path = require('path');
const { normalize, radioArtist } = require('./music-tags');

const DEFAULT_MIX_DIRECTORY = path.resolve(__dirname, '..', '..', 'defaults', 'local-mixes');
const DATA_DIRECTORY_NAME = 'local-mixes';
// These books were shipped as experiments but have since been retired. Removing
// them here also removes the old copied default from portable Data.
const RETIRED_FORMAT_BOOKS = new Set(['yacht-rock.json']);

const exact = (left, right) => Boolean(left && right && normalize(left) === normalize(right));
const uniqueText = values => [...new Map((Array.isArray(values) ? values : [])
  .map(value => String(value || '').trim()).filter(Boolean).map(value => [normalize(value), value])).values()];
const trackArtists = track => uniqueText([radioArtist(track), track?.artist, ...(Array.isArray(track?.artists) ? track.artists : [])]);
const yearOf = track => {
  const value = String(track?.originalYear || track?.year || '').match(/(?:18|19|20)\d{2}/);
  return value ? Number(value[0]) : null;
};
const trackMatches = (track, artist, title) => trackArtists(track).some(value => exact(value, artist)) && exact(track?.title, title);

function mixDirectory(dataDir) { return path.join(String(dataDir || ''), DATA_DIRECTORY_NAME); }

// Defaults ship with WaveDeck. Once copied to portable Data they belong to the
// user: later app updates may add missing books, but never overwrite a book
// the listener has edited.
function ensureFormatBooks(dataDir) {
  const destination = mixDirectory(dataDir);
  try {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of RETIRED_FORMAT_BOOKS) {
      const target = path.join(destination, name);
      if (fs.existsSync(target)) fs.rmSync(target);
    }
    for (const name of fs.readdirSync(DEFAULT_MIX_DIRECTORY)) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      const source = path.join(DEFAULT_MIX_DIRECTORY, name);
      const target = path.join(destination, name);
      if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    }
  } catch (error) {
    throw new Error(`Local Mix format books could not be prepared in Data: ${error.message}`);
  }
  return destination;
}

function cleanRule(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const artist = String(value.artist || '').trim();
  if (!artist) return null;
  const fromYear = Number(value.fromYear);
  const toYear = Number(value.toYear);
  return {
    artist,
    fromYear: Number.isInteger(fromYear) ? fromYear : null,
    toYear: Number.isInteger(toYear) ? toYear : null,
    tier: String(value.tier || '').trim(),
    allowAnyYear: value.allowAnyYear === true
  };
}

function cleanSong(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const artist = String(value[0] || '').trim();
  const title = String(value[1] || '').trim();
  return artist && title ? [artist, title] : null;
}

function cleanMix(raw, sourceFile) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${sourceFile} is not a Local Mix object.`);
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  const description = String(raw.description || '').trim();
  if (!id || !/^[a-z0-9-]+$/.test(id) || !name || !description) throw new Error(`${sourceFile} needs a valid id, name, and description.`);
  const policy = raw.formatPolicy && typeof raw.formatPolicy === 'object' ? raw.formatPolicy : {};
  const range = policy.trackYear && typeof policy.trackYear === 'object' ? policy.trackYear : {};
  const from = Number(range.from); const to = Number(range.to);
  return {
    id, name, description, sourceFile,
    coreArtists: uniqueText(raw.coreArtists),
    approvedArtists: uniqueText(raw.approvedArtists),
    artistRules: (Array.isArray(raw.artistRules) ? raw.artistRules : []).map(cleanRule).filter(Boolean),
    coreSongs: (Array.isArray(raw.coreSongs) ? raw.coreSongs : []).map(cleanSong).filter(Boolean),
    seeds: (Array.isArray(raw.seedSuggestions) ? raw.seedSuggestions : []).map(cleanSong).filter(Boolean),
    policy: {
      fromYear: Number.isInteger(from) ? from : null,
      toYear: Number.isInteger(to) ? to : null,
      unknownYear: String(policy.unknownYear || '').trim() || 'allowOnlyForCoreArtistWhenNoExplicitExclusionApplies',
      songSpecific: Boolean(policy.songSpecific)
    }
  };
}

function loadLocalMixes(dataDir) {
  const directory = dataDir ? ensureFormatBooks(dataDir) : DEFAULT_MIX_DIRECTORY;
  const mixes = [];
  const seen = new Set();
  for (const name of fs.readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    let mix;
    try { mix = cleanMix(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')), name); }
    catch (error) { throw new Error(`Local Mix format book ${name} could not be read: ${error.message}`); }
    if (seen.has(mix.id)) throw new Error(`Local Mix id ${mix.id} appears more than once in Data.`);
    seen.add(mix.id); mixes.push(mix);
  }
  if (!mixes.length) throw new Error('No Local Mix format books are available in Data.');
  return mixes;
}

function listLocalMixes(dataDir) {
  return loadLocalMixes(dataDir).map(({ id, name, description, sourceFile }) => ({ id, name, description, sourceFile }));
}

function matchingRule(track, mix) {
  return mix.artistRules.find(rule => trackArtists(track).some(artist => exact(artist, rule.artist))) || null;
}

function isTrackEligibleForMix(track, mix) {
  const artists = trackArtists(track);
  const coreSong = mix.coreSongs.some(([artist, title]) => trackMatches(track, artist, title));
  const coreArtist = artists.some(artist => mix.coreArtists.some(candidate => exact(candidate, artist)));
  const approvedArtist = artists.some(artist => mix.approvedArtists.some(candidate => exact(candidate, artist)));
  const rule = matchingRule(track, mix);
  const formatMember = coreSong || coreArtist || approvedArtist || Boolean(rule);
  if (!formatMember) return { eligible: false, reason: 'outside curated Local Mix roster', tier: '' };
  if (mix.policy.songSpecific && !coreSong) return { eligible: false, reason: 'not a reviewed song for this Local Mix', tier: '' };
  const year = yearOf(track);
  const from = rule?.allowAnyYear ? null : (rule?.fromYear ?? mix.policy.fromYear);
  const to = rule?.allowAnyYear ? null : (rule?.toYear ?? mix.policy.toYear);
  if (year !== null && ((from !== null && year < from) || (to !== null && year > to))) return { eligible: false, reason: 'outside Local Mix era', tier: '' };
  if (year === null && !coreSong && !(coreArtist && mix.policy.unknownYear === 'allowOnlyForCoreArtistWhenNoExplicitExclusionApplies')) {
    return { eligible: false, reason: 'missing trustworthy era data', tier: '' };
  }
  if (coreSong) return { eligible: true, reason: 'reviewed Local Mix song', tier: 'song' };
  if (coreArtist) return { eligible: true, reason: 'core Local Mix artist', tier: 'core' };
  return { eligible: true, reason: 'approved Local Mix artist', tier: 'approved' };
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter(track => {
    const key = String(track?.songKey || track?.id || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function resolveLocalMix(id, tracks = [], dataDir) {
  const definition = loadLocalMixes(dataDir).find(mix => mix.id === String(id || ''));
  if (!definition) throw new Error('That Local Mix is no longer available.');
  const eligibleTracks = tracks.filter(track => !track?.doNotPlay && isTrackEligibleForMix(track, definition).eligible);
  if (eligibleTracks.length < 4) throw new Error(`${definition.name} needs at least four eligible songs in your Local Music library before it can play.`);
  const seeds = definition.seeds.map(([artist, title]) => tracks.find(track => trackMatches(track, artist, title))).filter(Boolean);
  const fallbackSeeds = definition.coreSongs.map(([artist, title]) => tracks.find(track => trackMatches(track, artist, title))).filter(Boolean);
  return { ...definition, artists: uniqueText([...definition.coreArtists, ...definition.approvedArtists]), seeds: uniqueTracks([...seeds, ...fallbackSeeds]).slice(0, 30) };
}

module.exports = { listLocalMixes, resolveLocalMix, isTrackEligibleForMix, loadLocalMixes, ensureFormatBooks, trackArtists, yearOf };
