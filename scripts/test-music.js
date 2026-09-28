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
const { resolveLocalMix, listLocalMixes, getLocalMixAvailability, isTrackEligibleForMix } = require('../src/main/local-mixes');

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
    const tenPointRating = extractTrack({ common: {}, native: { 'ID3v2.4': [{ id: 'TXXX:RATING', value: '5' }] } }, 'five-of-ten.mp3');
    assert.equal(tenPointRating.rating, 5, 'custom RATING remains on the portable 0–10 scale');
    assert.equal(tenPointRating.ratingStars, 2.5, 'custom RATING=5 means 2.5 stars');
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
    const unratedPopular = track('unrated-popular', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'A Momentary Lapse of Reason', popularity: 100 });
    const ratedSix = track('rated-six', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Meddle', popularity: 0, rating: 6, ratingStars: 3 });
    const ratedSeven = track('rated-seven', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'The Dark Side of the Moon', popularity: 0, rating: 7, ratingStars: 3.5 });
    const ratedTen = track('rated-ten', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Wish You Were Here', popularity: 0, rating: 10, ratingStars: 5 });
    const personalPoolRadio = new MusicRadio({ dataDir: path.join(temp, 'personal-pool'), now: () => now, random: () => 0.99, getFamiliarity: () => 'hits' });
    const personalPoolPick = personalPoolRadio.choose([unratedPopular, ratedSix, ratedSeven, ratedTen], seed, 'artist');
    assert(['rated-seven', 'rated-ten'].includes(personalPoolPick.id), 'Favor the Hits excludes unrated and 6/10 songs when 7–10 songs are available');
    assert.equal(personalPoolRadio.getLastDecision().counts.personal, 2, 'diagnostics identify the personal pool');
    assert.equal(personalPoolRadio.getLastDecision().counts.lastFmFamiliar, 0, 'Last.fm does not dilute an available personal pool');
    const balancedPoolRadio = new MusicRadio({ dataDir: path.join(temp, 'balanced-pool'), now: () => now, random: () => 0, getFamiliarity: () => 'balanced' });
    assert(['rated-six', 'rated-seven', 'rated-ten'].includes(balancedPoolRadio.choose([unratedPopular, ratedSix, ratedSeven, ratedTen], seed, 'artist').id), 'Balanced Mix uses its 5–10 personal pool');
    const deepPoolRadio = new MusicRadio({ dataDir: path.join(temp, 'deep-pool'), now: () => now, random: () => 0, getFamiliarity: () => 'deep-cuts' });
    const ratedThree = track('rated-three', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'More', popularity: 0, rating: 3, ratingStars: 1.5 });
    assert.equal(deepPoolRadio.choose([unratedPopular, ratedThree, ratedTen], seed, 'artist').id, ratedThree.id, 'Play Deep Cuts Too keeps 3/10 music in the personal pool');
    const blockedHit = track('blocked-hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], popularity: 100, ratingStars: 5, favorite: true, doNotPlay: true });
    assert.equal(personalizedHits.choose([blockedHit, hit], seed, 'artist').id, hit.id, 'Do Not Play blocks even a favorite high-rated hit');
    assert.equal(personalizedHits.getLastDecision().counts.skippedForDoNotPlay, 1);
    radio.record(sameAlbum); assert.equal(radio.choose([sameAlbum], seed, 'radio'), null, 'exact song repeats wait two hours'); now += COOLDOWN;
    assert.equal(radio.choose([sameAlbum], seed, 'radio').id, sameAlbum.id); assert.equal(radio.getLastDecision().policy, 'automatic-local-radio-v2');
    const dayWaitRadio = new MusicRadio({ dataDir: path.join(temp, 'day-wait'), now: () => now, random: () => 0, getTuning: () => ({ songRepeatHours: 24, artistRepeatMinutes: 30, artistSetSize: 1 }) });
    assert.equal(dayWaitRadio.choose([sameAlbum], seed, 'radio').id, sameAlbum.id); dayWaitRadio.record(sameAlbum); now += 23 * 60 * 60 * 1000;
    assert.equal(dayWaitRadio.choose([sameAlbum], seed, 'radio'), null, 'the 24-hour song-repeat stop is honored'); now += 60 * 60 * 1000;
    assert.equal(dayWaitRadio.choose([sameAlbum], seed, 'radio').id, sameAlbum.id, 'the 24-hour song-repeat stop releases at 24 hours');
    const rotationA = track('rotation-a', { artist: 'David Gilmour', artists: ['David Gilmour'], albumArtist: 'David Gilmour', album: 'A' });
    const rotationB = track('rotation-b', { artist: 'David Gilmour', artists: ['David Gilmour'], albumArtist: 'David Gilmour', album: 'B' });
    const artistWaitRadio = new MusicRadio({ dataDir: path.join(temp, 'artist-wait'), now: () => now, random: () => 0, getTuning: () => ({ songRepeatHours: 2, artistRepeatMinutes: 90, artistSetSize: 1 }) });
    assert.equal(artistWaitRadio.choose([rotationA], seed, 'radio').id, rotationA.id); artistWaitRadio.record(rotationA);
    assert.equal(artistWaitRadio.choose([rotationB], seed, 'radio'), null, 'artist repeat wait blocks a different song by the same artist');
    const twoFerRadio = new MusicRadio({ dataDir: path.join(temp, 'two-fer'), now: () => now, random: () => 0, getTuning: () => ({ songRepeatHours: 2, artistRepeatMinutes: 90, artistSetSize: 2 }) });
    assert.equal(twoFerRadio.choose([rotationA, rotationB], seed, 'radio').id, rotationA.id); twoFerRadio.record(rotationA);
    assert.equal(twoFerRadio.choose([rotationA, rotationB], seed, 'radio').id, rotationB.id, 'Artist Sets intentionally continues the selected artist');

    const feedbackDir = path.join(temp, 'feedback');
    const feedbackRadio = new MusicRadio({ dataDir: feedbackDir, now: () => now, random: () => 0.99 });
    const feedbackA = track('feedback-a', { artist: 'Pink Floyd', artists: ['Pink Floyd'], rating: 8 });
    const feedbackB = track('feedback-b', { artist: 'Pink Floyd', artists: ['Pink Floyd'], rating: 8 });
    feedbackRadio.recordFeedback('mix:classic-rock', feedbackA, 'down');
    feedbackRadio.recordFeedback('mix:classic-rock', feedbackB, 'up');
    assert.equal(feedbackRadio.choose([feedbackA, feedbackB], seed, 'artist', new Set(), 'next', 'mix:classic-rock').id, feedbackB.id, 'Local Mix feedback changes only that station’s selection weights');
    assert.equal(new MusicRadio({ dataDir: feedbackDir }).feedbackFor('mix:classic-rock')[feedbackB.songKey].up, 1, 'Local Radio feedback persists in portable Data');

    const classicSeedTracks = [
      track('classic-boston', { artist: 'Boston', albumArtist: 'Boston', title: 'Foreplay/Long Time', year: 1976 }),
      track('classic-pink', { artist: 'Pink Floyd', albumArtist: 'Pink Floyd', title: 'Comfortably Numb', year: 1979 }),
      track('classic-zeppelin', { artist: 'Led Zeppelin', albumArtist: 'Led Zeppelin', title: 'Ramble On', year: 1969 }),
      track('classic-aerosmith', { artist: 'Aerosmith', albumArtist: 'Aerosmith', title: 'Sweet Emotion', year: 1975 }),
      ...Array.from({ length: 16 }, (_value, index) => track(`classic-boston-${index}`, { artist: 'Boston', albumArtist: 'Boston', title: `Boston Song ${index}`, year: 1976 }))
    ];
    const portableMixData = path.join(temp, 'mix-format-books');
    assert.deepEqual(listLocalMixes(portableMixData).map(mix => mix.id), ['alternative-80s', 'classic-country', 'classic-hits', 'classic-rock', 'grunge-era-rock', 'rock-and-metal'], 'all shipped Local Mix books copy to portable Data');
    let mixAvailability = getLocalMixAvailability(portableMixData, classicSeedTracks);
    const classicAvailability = mixAvailability.find(mix => mix.id === 'classic-rock');
    assert.equal(classicAvailability.ready, true, 'Local Mixes need at least twenty eligible songs before they can appear');
    assert.equal(classicAvailability.enabled, true, 'shipped Local Mixes are available by default');
    await fs.writeFile(path.join(portableMixData, 'local-mixes', 'outside-book.json'), JSON.stringify({ id: 'outside-book', name: 'Outside Book', description: 'Test optional book', coreArtists: ['Boston'] }));
    mixAvailability = getLocalMixAvailability(portableMixData, classicSeedTracks);
    assert.equal(mixAvailability.find(mix => mix.id === 'outside-book').enabled, false, 'new externally added Local Mix books start hidden');
    const classicMix = resolveLocalMix('classic-rock', classicSeedTracks, portableMixData);
    assert.equal(classicMix.seeds.length, 4, 'Classic Rock resolves its curated seed tracks from the Local Music library');
    assert.equal(isTrackEligibleForMix(track('early-beatles', { artist: 'The Beatles', title: 'Act Naturally', year: 1965 }), classicMix).eligible, false, 'Classic Rock rejects early Beatles');
    assert.equal(isTrackEligibleForMix(track('late-aerosmith', { artist: 'Aerosmith', title: 'Under My Skin', year: 2001 }), classicMix).eligible, false, 'Classic Rock rejects post-format Aerosmith');
    assert.equal(isTrackEligibleForMix(track('black-ice', { artist: 'AC/DC', title: 'Rock ’n’ Roll Train', year: 2008 }), classicMix).eligible, true, 'Classic Rock keeps later AC/DC eligible');
    assert.equal(isTrackEligibleForMix(classicSeedTracks[0], classicMix).eligible, true, 'Classic Rock keeps its intended core material');
    const classicRadio = new MusicRadio({ dataDir: path.join(temp, 'classic-format'), now: () => now, random: () => 0 });
    const modernColdplay = track('coldplay', { artist: 'Coldplay', artists: ['Coldplay'], title: 'Charlie Brown', year: 2011, rating: 10, similarArtists: ['U2'] });
    assert.equal(classicRadio.choose([...classicSeedTracks, modernColdplay], classicMix, 'mix').artist, 'Boston', 'Last.fm similarity cannot admit a non-format Classic Rock artist');
    assert.throws(() => resolveLocalMix('yacht-rock', classicSeedTracks, portableMixData), /no longer available/, 'the retired Yacht Rock book is removed from portable Data');
    const grungeTracks = [
      track('grunge-1', { artist: 'Nirvana', title: 'Come as You Are', year: 1991 }),
      track('grunge-2', { artist: 'Pearl Jam', title: 'Even Flow', year: 1991 }),
      track('grunge-3', { artist: 'Soundgarden', title: 'Black Hole Sun', year: 1994 }),
      track('grunge-4', { artist: 'Stone Temple Pilots', title: 'Interstate Love Song', year: 1994 }),
      ...Array.from({ length: 16 }, (_value, index) => track(`grunge-nirvana-${index}`, { artist: 'Nirvana', title: `Nirvana Song ${index}`, year: 1991 }))
    ];
    const grungeMix = resolveLocalMix('grunge-era-rock', grungeTracks, portableMixData);
    assert.equal(isTrackEligibleForMix(track('late-nu-metal', { artist: 'Linkin Park', title: 'In the End', year: 2000 }), grungeMix).eligible, false, 'Grunge Era Rock keeps later nu metal out');
    assert.equal(isTrackEligibleForMix(grungeTracks[0], grungeMix).eligible, true, 'Grunge Era Rock admits core period material');

    const player = { getStatus: () => ({ playing: true, position: 0 }), setStationGain: async () => {}, play: async () => {}, stop: async () => {}, setPaused: async () => {}, seek: async () => {} };
    const tracks = [track('2', { track: 2 }), track('1'), track('3', { album: 'Other' }), track('blocked', { doNotPlay: true })]; const fakeLibrary = { tracks, resolve: async id => { const found = tracks.find(t => t.id === id); if (!found) throw Error('missing'); return { ...found, path: '/' + id }; } };
    const controller = serializeTransport(new MediaController({ player, getStations: () => [{ id: 's', url: 'https://example.org', name: 'Streaming', preset: true }] })); controller.configureMusic(fakeLibrary, new MusicRadio({ dataDir: path.join(temp, 'playback'), now: () => now }));
    await controller.playMusic('2', 'album'); assert.equal(controller.getStatus().currentMusic.track.id, '1'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.track.id, '2'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.mode, 'artist'); await controller.playMusic('1', 'radio'); assert.equal(controller.getStatus().currentMusic.seed.id, '1'); await assert.rejects(controller.playMusic('blocked', 'radio'), /marked Do Not Play/); await controller.playStationById('s'); assert.equal(controller.getStatus().currentMusic, null);
    let position = 0; const crossfades = [];
    const crossfadePlayer = {
      isCrossfading: false,
      getStatus: () => ({ playing: true, position, duration: 2 }),
      setStationGain: async () => {}, play: async () => {}, stop: async () => {}, setPaused: async () => {}, seek: async () => {},
      crossfadeTo: async (file, duration) => { crossfades.push({ file, duration }); position = 0; }
    };
    const crossfadeTracks = [
      track('crossfade-a', { artist: 'Crossfade Artist', artists: ['Crossfade Artist'], duration: 2 }),
      track('crossfade-b', { artist: 'Crossfade Artist', artists: ['Crossfade Artist'], duration: 2 })
    ];
    const crossfadeLibrary = { tracks: crossfadeTracks, resolve: async id => {
      const found = crossfadeTracks.find(item => item.id === id); return { ...found, path: `/${id}` };
    } };
    const crossfadeController = serializeTransport(new MediaController({ player: crossfadePlayer, getStations: () => [], getCrossfadeEnabled: () => true }));
    crossfadeController.configureMusic(crossfadeLibrary, new MusicRadio({ dataDir: path.join(temp, 'crossfade'), now: () => now, random: () => 0 }));
    await crossfadeController.playMusic('crossfade-a', 'artist'); position = 1.5;
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(crossfades.length, 1, 'Local Music preselects and starts the next song during a crossfade');
    assert.equal(crossfades[0].file, '/crossfade-b');
    assert.equal(crossfadeController.getStatus().currentMusic.track.id, 'crossfade-b');
    await crossfadeController.stop();
    console.log('Music tests passed: read-only MP3 scan, Last.fm enrichment, Local Radio tuning, repeat protection, diagnostics, album handoff, and source switching.');
  } finally { library?.close(); await fs.rm(temp, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
