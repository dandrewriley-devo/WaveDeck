const path = require('path');
const crypto = require('crypto');
const normalize = (value) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const list = (value) => (Array.isArray(value) ? value : String(value || '').split(/[;|]/)).map(String).map(s => s.trim()).filter(Boolean);
function extractTrack(metadata, relativePath) {
  const c = metadata.common || {};
  const custom = {};
  for (const frames of Object.values(metadata.native || {})) for (const frame of frames) {
    if (frame.id.startsWith('TXXX:')) custom[frame.id.slice(5).toUpperCase()] = frame.value;
  }
  const number = (...keys) => {
    const value = keys.map(k => custom[k]).find(v => v !== undefined && v !== '');
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  // AMP uses 1–10; standard POPM is normalized by music-metadata to 0–1.
  const popm = c.rating?.find(r => Number.isFinite(r.rating))?.rating;
  const rating = number('RATING') ?? (popm === undefined ? null : Math.max(1, Math.round(popm * 10)));
  const title = c.title || path.basename(relativePath, path.extname(relativePath));
  const artist = c.artist || '';
  return {
    id: crypto.createHash('sha256').update(relativePath).digest('hex'), relativePath,
    title, artist, artists: c.artists || list(artist), album: c.album || '', albumArtist: c.albumartist || '',
    year: c.year || c.originalyear || null, genres: c.genre || [], composer: c.composer || [],
    comments: (c.comment || []).map(v => typeof v === 'string' ? v : v.text || ''),
    track: c.track?.no || 0, disc: c.disk?.no || 0, duration: metadata.format?.duration || 0,
    ampId: String(custom.AMP_TRACK_ID || ''), rating: rating > 0 ? Math.min(10, rating) : null,
    favorite: /^(1|true|yes)$/i.test(String(custom.FAVORITE || '')),
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
function radioArtist(track) { return !compilation(track) && track.albumArtist || track.artist; }
module.exports = { extractTrack, normalize, compilation, radioArtist };
