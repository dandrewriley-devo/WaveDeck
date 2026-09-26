const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { MusicLibrary } = require('../src/main/music-library');
const { MusicRadio, weight, COOLDOWN } = require('../src/main/music-radio');
const { extractTrack, radioArtist } = require('../src/main/music-tags');
const { MediaController, serializeTransport } = require('../src/main/media-controller');
const { LastFmEnricher, popularityScore } = require('../src/main/lastfm-enricher');

function fixture() {
  const frame = (id, value) => { const data = Buffer.concat([Buffer.from([0]), Buffer.from(value)]); const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(data.length, 4); return Buffer.concat([header, data]); };
  const body = Buffer.concat([frame('TIT2', 'Test Song'), frame('TPE1', 'Artist'), frame('TALB', 'Album'), frame('TCON', 'Pop'), frame('TXXX', 'RATING\0' + '8'), frame('TXXX', 'FAVORITE\0' + '1'), frame('TXXX', 'DO_NOT_PLAY\0' + '1')]);
  const header = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, 0]); let size = body.length;
  for (let i = 9; i >= 6; i--) { header[i] = size & 127; size >>= 7; }
  const audio = Buffer.alloc(417); Buffer.from([255, 251, 144, 100]).copy(audio);
  return Buffer.concat([header, body, ...Array.from({ length: 100 }, () => audio)]);
}
function track(id, more = {}) { return { id, songKey: id, title: id, artist: 'Artist', artists: ['Artist'], albumArtist: 'Artist', album: 'Album', track: Number(id) || 1, disc: 1, relativePath: `${id}.mp3`, genres: ['Pop'], similarArtists: [], rating: null, ...more }; }

async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wavedeck-music-test-')); let library;
  try {
    const dataDir = path.join(temp, 'Data'); const musicDir = path.join(temp, 'Music'); await fs.mkdir(musicDir, { recursive: true });
    const file = path.join(musicDir, 'song.MP3'); await fs.writeFile(file, fixture());
    const digest = async () => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); const before = await digest();
    library = new MusicLibrary({ dataDir }); await library.enable(); await library.rescan();
    assert.equal(library.tracks[0].ratingStars, 4, 'ratings are copied into the local index');
    assert.equal(library.tracks[0].favorite, true, 'Favorite tags are copied into the local index');
    assert.equal(library.tracks[0].doNotPlay, true, 'Do Not Play tags are copied into the local index');
    assert.equal(await digest(), before, 'scanning never changes MP3 bytes');
    assert.equal((await library.call('search', "' OR 1=1 --")).total, 0);
    assert.equal(extractTrack({ common: { rating: [{ rating: 0.8 }] }, native: {} }, 'fallback.mp3').ratingStars, 4);
    const doNotPlayTag = extractTrack({ common: {}, native: { 'ID3v2.4': [{ id: 'TXXX:DO_NOT_PLAY', value: 'yes' }, { id: 'TXXX:FAVORITE', value: 'true' }] } }, 'skip.mp3');
    assert.equal(doNotPlayTag.doNotPlay, true); assert.equal(doNotPlayTag.favorite, true);
    assert.equal(radioArtist(track('x', { albumArtist: 'Various Artists', artist: 'Solo' })), 'Solo');

    const savedTracks = []; const savedArtists = [];
    const lastFmLibrary = { enabled: true, worker: {}, getLastFmStatus: async () => ({ tracksTotal: 1, tracksCurrent: 0, queuedAlbums: 1 }), nextLastFmAlbum: async () => ({ albumKey: 'artist\\nalbum', queued: true, tracks: [track('lastfm')], artists: ['Artist'] }), updateLastFmTrack: async value => savedTracks.push(value), updateLastFmArtist: async value => savedArtists.push(value), applyLastFmTrack: () => {}, applyLastFmArtist: () => {}, completeLastFmAlbum: async () => {} };
    const enricher = new LastFmEnricher({ library: lastFmLibrary, getPreferences: () => ({ lastFmEnabled: true, lastFmApiKey: 'key' }), requestIntervalMs: 0, fetchImpl: async url => ({ ok: true, json: async () => url.includes('track.getInfo') ? { track: { listeners: '100000', toptags: { tag: [{ name: 'Progressive Rock' }] } } } : { similarartists: { artist: [{ name: 'David Gilmour' }] } } }) });
    await enricher.tick(); enricher.stop(); assert(savedTracks[0].popularity > 0 && savedArtists[0].similarArtists.includes('David Gilmour')); assert(popularityScore(100000) > popularityScore(1000));

    let now = 10_000_000;
    const seed = track('comfortably-numb', { title: 'Comfortably Numb', artist: 'Pink Floyd', artists: ['Pink Floyd'], albumArtist: 'Pink Floyd', album: 'The Wall', genres: ['Progressive Rock', 'Rock'], similarArtists: ['David Gilmour'] });
    const sameAlbum = track('run-like-hell', { title: 'Run Like Hell', artist: 'Pink Floyd', artists: ['Pink Floyd'], albumArtist: 'Pink Floyd', album: 'The Wall', genres: ['Rock'], ratingStars: 5 });
    const seedArtist = track('wish-you-were-here', { artist: 'Pink Floyd', artists: ['Pink Floyd'], albumArtist: 'Pink Floyd', album: 'Wish You Were Here', genres: ['Rock'] });
    const similar = track('gilmour', { artist: 'David Gilmour', artists: ['David Gilmour'], album: 'About Face', genres: ['Rock'] });
    const specificTag = track('prog', { artist: 'King Crimson', artists: ['King Crimson'], album: 'Red', genres: ['Progressive Rock'] });
    const country = track('devil', { title: 'The Devil Went Down to Georgia', artist: 'Charlie Daniels Band', artists: ['Charlie Daniels Band'], album: 'Million Mile Reflections', genres: ['Country', 'Rock'] });
    const radio = new MusicRadio({ dataDir, now: () => now, random: () => 0 });
    assert.equal(radio.choose([country], seed, 'radio'), null, 'a broad Rock tag alone is never enough');
    assert.equal(radio.choose([sameAlbum, country], seed, 'radio').id, sameAlbum.id, 'same-album songs lead Song Radio');
    assert(weight(seedArtist, seed, 'artist', [], now) > weight(similar, seed, 'artist', [], now), 'Artist Radio returns to seed artist');
    assert(weight(similar, seed, 'artist', [], now) > 0 && weight(specificTag, seed, 'radio', [], now) > 0, 'Last.fm and specific tags are meaningful links');
    assert.equal(weight(country, seed, 'radio', [], now), 0);
    assert(weight(track('rated', { artist: 'Pink Floyd', artists: ['Pink Floyd'], ratingStars: 5 }), seed, 'artist', [], now) > weight(track('unrated', { artist: 'Pink Floyd', artists: ['Pink Floyd'] }), seed, 'artist', [], now));
    const hit = track('hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Animals', popularity: 100 });
    const deepCut = track('deep-cut', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Obscured by Clouds', popularity: 0 });
    assert(weight(hit, seed, 'artist', [], now, null, 'hits') > weight(deepCut, seed, 'artist', [], now, null, 'hits'), 'Favor the Hits prefers credible popular songs');
    assert(weight(deepCut, seed, 'artist', [], now, null, 'deep-cuts') > weight(hit, seed, 'artist', [], now, null, 'deep-cuts'), 'Play Deep Cuts Too favors credible lesser-known songs');
    const familiarityRadio = new MusicRadio({ dataDir: path.join(temp, 'familiarity'), now: () => now, random: () => 0, getFamiliarity: () => 'hits' });
    assert.equal(familiarityRadio.choose([hit, deepCut], seed, 'artist').id, hit.id);
    assert.equal(familiarityRadio.getLastDecision().familiarity, 'hits');
    const favoriteDeepCut = track('favorite-deep-cut', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'More', popularity: 0, favorite: true });
    const lowRatedHit = track('low-rated-hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'The Division Bell', popularity: 100, ratingStars: 1 });
    const personalizedHits = new MusicRadio({ dataDir: path.join(temp, 'personalized-hits'), now: () => now, random: () => 0 });
    assert.equal(personalizedHits.choose([favoriteDeepCut, lowRatedHit], seed, 'artist').id, favoriteDeepCut.id, 'Favorite tags outrank public popularity in Favor the Hits');
    const blockedHit = track('blocked-hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], popularity: 100, ratingStars: 5, favorite: true, doNotPlay: true });
    assert.equal(personalizedHits.choose([blockedHit, hit], seed, 'artist').id, hit.id, 'Do Not Play blocks even a favorite high-rated hit');
    assert.equal(personalizedHits.getLastDecision().counts.skippedForDoNotPlay, 1);
    radio.record(sameAlbum); assert.equal(radio.choose([sameAlbum], seed, 'radio'), null, 'exact song repeats wait two hours'); now += COOLDOWN;
    assert.equal(radio.choose([sameAlbum], seed, 'radio').id, sameAlbum.id); assert.equal(radio.getLastDecision().policy, 'automatic-local-radio-v1');

    const player = { getStatus: () => ({ playing: true, position: 0 }), setStationGain: async () => {}, play: async () => {}, stop: async () => {}, setPaused: async () => {}, seek: async () => {} };
    const tracks = [track('2', { track: 2 }), track('1'), track('3', { album: 'Other' }), track('blocked', { doNotPlay: true })]; const fakeLibrary = { tracks, resolve: async id => { const found = tracks.find(t => t.id === id); if (!found) throw Error('missing'); return { ...found, path: '/' + id }; } };
    const controller = serializeTransport(new MediaController({ player, getStations: () => [{ id: 's', url: 'https://example.org', name: 'Streaming', preset: true }] })); controller.configureMusic(fakeLibrary, new MusicRadio({ dataDir: path.join(temp, 'playback'), now: () => now }));
    await controller.playMusic('2', 'album'); assert.equal(controller.getStatus().currentMusic.track.id, '1'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.track.id, '2'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.mode, 'artist'); await controller.playMusic('1', 'radio'); assert.equal(controller.getStatus().currentMusic.seed.id, '1'); await assert.rejects(controller.playMusic('blocked', 'radio'), /marked Do Not Play/); await controller.playStationById('s'); assert.equal(controller.getStatus().currentMusic, null);
    console.log('Music tests passed: read-only MP3 scan, Last.fm enrichment, automatic Local Radio relationships, repeat protection, diagnostics, album handoff, and source switching.');
  } finally { library?.close(); await fs.rm(temp, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
