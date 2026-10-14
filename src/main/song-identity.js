const { normalize, radioArtist } = require('./music-tags');

function artistKey(track) {
  return normalize(radioArtist(track) || track?.artist || '');
}

function titleForIdentity(track) {
  return String(track?.title || track?.name || '')
    .replace(/\s*[\[(]?\s*(?:(?:digital\s+)?remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)(?:\s+version)?\s*[\])]?\s*$/i, '');
}

function baseSongIdentity(track) {
  return `${artistKey(track)}\u0000${normalize(titleForIdentity(track))}`;
}

// radioIdentity is persisted in music.sqlite after the portable-library pass.
// Old entries and non-portable tracks deliberately fall back to the stable base
// identity so choosing music never waits for maintenance to finish.
function songIdentity(track) {
  return String(track?.radioIdentity || baseSongIdentity(track));
}

function titleForComparison(track) {
  return String(track?.title || track?.name || '')
    .replace(/\s*[(\[]?\s*(?:live|acoustic|demo|radio edit|single version)[^\])]*[\])]?\s*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
}

function editDistanceAtMostOne(left, right) {
  if (left === right) return true;
  if (!left || !right || Math.abs(left.length - right.length) > 1) return false;
  let index = 0; let other = 0; let edits = 0;
  while (index < left.length && other < right.length) {
    if (left[index] === right[other]) { index += 1; other += 1; continue; }
    if (++edits > 1) return false;
    if (left.length > right.length) index += 1;
    else if (right.length > left.length) other += 1;
    else { index += 1; other += 1; }
  }
  return true;
}

function sameSong(track, other) {
  if (!track || !other || artistKey(track) !== artistKey(other)) return false;
  if (songIdentity(track) === songIdentity(other)) return true;
  const left = titleForComparison(track); const right = titleForComparison(other);
  const durationLeft = Number(track.duration); const durationRight = Number(other.duration);
  return left.length >= 8 && right.length >= 8 && Number.isFinite(durationLeft) && Number.isFinite(durationRight)
    && Math.abs(durationLeft - durationRight) <= 4 && editDistanceAtMostOne(left, right);
}

// Strings within one edit share at least one deletion signature. The identity
// rebuild uses these as a small candidate lookup before asking sameSong().
function comparisonSignatures(track) {
  const title = titleForComparison(track);
  if (!title) return [];
  const values = new Set([title]);
  if (title.length >= 8) {
    for (let index = 0; index < title.length; index += 1) values.add(`${title.slice(0, index)}${title.slice(index + 1)}`);
  }
  return [...values];
}

module.exports = { artistKey, baseSongIdentity, songIdentity, sameSong, comparisonSignatures };
