const path = require('path');
const crypto = require('crypto');
const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const list = (value) => (Array.isArray(value) ? value : String(value || '').split(/[;|]/)).map(String).map(s => s.trim()).filter(Boolean);
const PORTABLE_CUSTOM_TAGS = new Set(['RATING', 'FAVORITE', 'DO_NOT_PLAY', 'PLAY_COUNT', 'PLAYCOUNT', 'SKIP_COUNT', 'SKIPCOUNT', 'LAST_PLAYED', 'LASTFM_TRACK_POPULARITY_0_100', 'LASTFM_ARTIST_SIMILAR', 'MOOD', 'AMP_TRACK_ID']);
// Some ID3 readers treat the slash in AC/DC as an artist separator and leave
// only "AC" in the primary artist field. Canonicalize that known legacy form
// everywhere WaveDeck displays or matches an artist.
const canonicalArtist = value => normalize(value) === 'ac' ? 'AC/DC' : String(value || '').trim();
function customTags(metadata) {
  const custom = {};
  for (const frames of Object.values(metadata?.native || {})) for (const frame of frames || []) {
    const id = String(frame?.id || '');
    if (id.startsWith('TXXX:')) { custom[id.slice(5).toUpperCase()] = frame.value; continue; }
    const key = id.toUpperCase();
    if (PORTABLE_CUSTOM_TAGS.has(key)) custom[key] = frame.value;
  }
  return custom;
}
function portableTrackId(relativePath, library) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/\.[^.\/]+$/, '');
  return crypto.createHash('sha256').update(`${library}\0${normalizedPath}`).digest('hex');
}
function extractTrack(metadata, relativePath, library = 'portable') {
  const c = metadata.common || {};
  const custom = customTags(metadata);
  const number = (...keys) => {
    const value = keys.map(k => custom[k]).find(v => v !== undefined && v !== '');
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const numeric = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number(String(value ?? '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  };
  const normalizeRating = (value, format) => {
    const parsed = numeric(value);
    if (parsed === null || parsed <= 0) return null;
    let stars;
    if (format === 'popm' || format === 'fmps') {
      stars = parsed <= 1 ? parsed * 5 : parsed > 5 ? parsed / 20 : parsed;
    } else if (format === 'amp' || format === 'txxx') {
      // WaveDeck's portable library uses its custom RATING tag as 0–10:
      // 5 means 2.5 stars, 10 means 5 stars. Zero is an unrated track.
      stars = parsed / 2;
    } else {
      stars = parsed;
    }
    return Math.max(0, Math.min(5, stars));
  };
  const ampRating = numeric(custom.RATING);
  const txxxRating = numeric(custom.RATING);
  const fmpsRating = numeric(custom.FMPS_RATING);
  const popm = c.rating?.find(r => Number.isFinite(r.rating))?.rating;
  const ratingCandidates = [
    ampRating !== null && custom.AMP_TRACK_ID ? { value: ampRating, format: 'amp', source: 'amp' } : null,
    fmpsRating !== null ? { value: fmpsRating, format: 'fmps', source: 'fmps_rating' } : null,
    txxxRating !== null ? { value: txxxRating, format: 'txxx', source: 'txxx_rating' } : null,
    popm !== undefined ? { value: popm, format: 'popm', source: 'popm' } : null
  ].filter(Boolean);
  const ratingEntry = ratingCandidates.map(entry => ({ ...entry, stars: normalizeRating(entry.value, entry.format) }))
    .find(entry => entry.stars !== null);
  const ratingStars = ratingEntry?.stars ?? null;
  // Preserve the historical 0–10 field for compatibility while ratingStars is the canonical 0–5 value.
  const rating = ratingStars === null ? null : Math.round(ratingStars * 2);
  const title = c.title || path.basename(relativePath, path.extname(relativePath));
  const artist = canonicalArtist(c.artist || '');
  return {
    id: portableTrackId(relativePath, library), relativePath, library,
    title, artist, artists: (c.artists || list(artist)).map(canonicalArtist), album: c.album || '', albumArtist: canonicalArtist(c.albumartist || ''),
    year: c.year || c.originalyear || null, genres: c.genre || [], composer: c.composer || [],
    comments: (c.comment || []).map(v => typeof v === 'string' ? v : v.text || ''),
    track: c.track?.no || 0, disc: c.disk?.no || 0, duration: metadata.format?.duration || 0,
    ampId: String(custom.AMP_TRACK_ID || ''), rating, ratingStars,
    ratingSource: ratingEntry?.source || '',
    favorite: /^(1|true|yes)$/i.test(String(custom.FAVORITE || '')),
    doNotPlay: /^(1|true|yes)$/i.test(String(custom.DO_NOT_PLAY || '')),
    playCount: number('PLAY_COUNT', 'PLAYCOUNT') || 0, skipCount: number('SKIP_COUNT', 'SKIPCOUNT') || 0,
    lastPlayed: String(custom.LAST_PLAYED || ''),
    popularity: number('LASTFM_TRACK_POPULARITY_0_100'),
    similarArtists: list(custom.LASTFM_ARTIST_SIMILAR), moods: list(custom.MOOD || c.mood),
    recordingId: String(c.musicbrainz_recordingid || ''),
    songKey: normalize(artist) + '\n' + normalize(title)
  };
}
function compilation(track) {
  return /^(various( artists)?|va|v\.a\.|soundtrack|original (motion picture )?(soundtrack|cast))$/i.test(track.albumArtist || '') ||
    /soundtrack|original motion picture/i.test(track.album || '');
}
function radioArtist(track) { return canonicalArtist((!compilation(track) && track.albumArtist) || track.artist); }
module.exports = { extractTrack, customTags, portableTrackId, normalize, canonicalArtist, compilation, radioArtist };
