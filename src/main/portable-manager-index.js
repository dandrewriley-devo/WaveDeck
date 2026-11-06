const { normalize } = require('./music-tags');

const portableManagerArtistKey = artist => normalize(artist || 'Unknown Artist') || 'unknown artist';
function portableManagerReleaseKey(track) {
  const album = String(track.album || '').trim();
  return album ? `album:${normalize(track.albumArtist || track.artist)}\n${album.toLocaleLowerCase()}` : `single:${track.id}`;
}
function portableManagerReleaseYear(tracks = []) {
  const years = tracks.map(track => Number(track.year)).filter(year => Number.isInteger(year) && year >= 1000 && year <= 9999);
  if (!years.length) return null;
  const counts = new Map();
  for (const year of years) counts.set(year, (counts.get(year) || 0) + 1);
  return [...counts].sort((left, right) => (counts.get(right) - counts.get(left)) || (left - right))[0];
}
function trackSearchText(track) {
  return [track.artist, track.albumArtist, track.album, track.title, ...(track.genres || [])]
    .map(value => String(value || '').toLocaleLowerCase()).join('\n');
}

class PortableManagerIndex {
  constructor() { this.source = null; this.revision = -1; this.groups = new Map(); this.byId = new Map(); this.list = []; }

  ensure(tracks, revision = 0) {
    if (this.source === tracks && this.revision === revision) return;
    this.source = tracks; this.revision = revision;
    this.groups = new Map(); this.byId = new Map();
    for (const track of tracks || []) {
      if (track.library !== 'portable') continue;
      const key = portableManagerArtistKey(track.artist);
      if (!this.groups.has(key)) this.groups.set(key, { key, tracks: [] });
      this.groups.get(key).tracks.push(track);
      this.byId.set(track.id, track);
    }
    for (const group of this.groups.values()) this.summarize(group);
    this.sort();
  }

  summarize(group) {
    const tracks = group.tracks;
    const ratedCount = tracks.reduce((count, track) => count + (Number(track.rating) > 0 ? 1 : 0), 0);
    group.summary = {
      key: group.key, artist: String(tracks[0].artist || 'Unknown Artist').trim() || 'Unknown Artist',
      itemCount: new Set(tracks.map(portableManagerReleaseKey)).size,
      trackCount: tracks.length, ratedCount,
      ratedPercent: tracks.length ? Math.round(ratedCount / tracks.length * 100) : 0
    };
    group.searchText = tracks.map(trackSearchText).join('\n');
  }

  sort() {
    this.list = [...this.groups.values()].sort((left, right) => left.summary.artist.localeCompare(right.summary.artist, undefined, { sensitivity: 'base' }));
  }

  summaries(query = '') {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return this.list.filter(group => !needle || group.searchText.includes(needle)).map(group => group.summary);
  }
  tracksForArtist(key, query = '') {
    const group = this.groups.get(String(key || ''));
    if (!group) return [];
    const needle = String(query || '').trim().toLocaleLowerCase();
    return needle ? group.tracks.filter(track => trackSearchText(track).includes(needle)) : group.tracks;
  }
  track(id) { return this.byId.get(String(id || '')) || null; }

  replaceTrack(previous, next, revision, previousRevision = revision - 1) {
    if (this.revision !== previousRevision || !this.source || !previous || !next) return;
    const oldKey = portableManagerArtistKey(previous.artist), newKey = portableManagerArtistKey(next.artist);
    const oldGroup = this.groups.get(oldKey);
    if (!oldGroup) return;
    const index = oldGroup.tracks.findIndex(track => track.id === previous.id);
    if (index < 0) return;
    oldGroup.tracks.splice(index, 1);
    if (!oldGroup.tracks.length) this.groups.delete(oldKey);
    else this.summarize(oldGroup);
    if (!this.groups.has(newKey)) this.groups.set(newKey, { key: newKey, tracks: [] });
    const group = this.groups.get(newKey);
    group.tracks.push(next);
    this.summarize(group);
    this.byId.set(next.id, next);
    this.revision = revision;
    if (oldKey !== newKey) this.sort();
  }
}

module.exports = { PortableManagerIndex, portableManagerArtistKey, portableManagerReleaseKey, portableManagerReleaseYear };
