const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { MusicLibrary } = require('../src/main/music-library');
const { MusicRadio, weight, COOLDOWN } = require('../src/main/music-radio');
const { extractTrack, radioArtist } = require('../src/main/music-tags');
const { OpusOptimizer, OPUS_BITRATE, SOURCE_EXTENSIONS, outputFor, stableAmpId } = require('../src/main/opus-optimizer');
const { trackKey } = require('../src/main/portable-importer');
const { ComputerMusicFolders, resolveComputerIdentity } = require('../src/main/computer-music-folders');
const { MediaController, serializeTransport } = require('../src/main/media-controller');
const { LastFmEnricher, popularityScore } = require('../src/main/lastfm-enricher');
const { LastFmScrobbler, signatureFor } = require('../src/main/lastfm-scrobbler');
const { resolveLocalMix, listLocalMixes, loadLocalMixes, getLocalMixAvailability, isTrackEligibleForMix, qualityForTrackCount } = require('../src/main/local-mixes');

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
  assert.ok(SOURCE_EXTENSIONS.has('.flac'), 'portable Music recognizes FLAC sources for conversion');
  assert.equal(trackKey(track('1', { title: 'Same Song', track: 1, duration: 245 })), trackKey(track('2', { title: 'Same Song', track: 1, duration: 245 })), 'portable imports identify matching tagged tracks regardless of source path');
  assert.equal(qualityForTrackCount(19), 'Not Enough');
  assert.equal(qualityForTrackCount(20), 'Weak');
  assert.equal(qualityForTrackCount(50), 'Solid');
  assert.equal(qualityForTrackCount(150), 'Strong');
  assert.equal(qualityForTrackCount(400), 'Excellent');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wavedeck-music-test-')); let library;
  try {
    const computerIdentity = resolveComputerIdentity({ platform: 'linux', hostname: 'test-computer', readFile: () => 'stable-machine-id\n' });
    assert.equal(computerIdentity.label, 'test-computer', 'saved computer folders use a friendly local computer name');
    const computerFolders = new ComputerMusicFolders({ dataDir: path.join(temp, 'computer-folders') });
    computerFolders.initialize();
    computerFolders.remember({ ...computerIdentity, folder: '/mnt/test-music' });
    assert.equal(computerFolders.get(computerIdentity.id).folder, '/mnt/test-music', 'an Additional Music Folder can be remembered per computer');
    computerFolders.rename(computerIdentity.id, 'Andrew’s Desk');
    assert.equal(computerFolders.list()[0].label, 'Andrew’s Desk', 'remembered computers can have a custom name');
    const reloadedComputerFolders = new ComputerMusicFolders({ dataDir: path.join(temp, 'computer-folders') });
    reloadedComputerFolders.initialize();
    assert.equal(reloadedComputerFolders.get(computerIdentity.id).folder, '/mnt/test-music', 'remembered computer folders persist in portable Data');
    const dataDir = path.join(temp, 'Data'); const musicDir = path.join(temp, 'Music'); await fs.mkdir(musicDir, { recursive: true });
    const file = path.join(musicDir, 'song.MP3'); await fs.writeFile(file, fixture());
    const digest = async () => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); const before = await digest();
    library = new MusicLibrary({ dataDir }); await library.enable(); await library.rescan();
    const indexedRevision = library.revision;
    const unchangedScan = await library.rescan();
    assert.equal(unchangedScan.changed, false, 'an unchanged library scan reports that it found nothing new');
    assert.equal(library.revision, indexedRevision, 'an unchanged library scan keeps the ready in-memory index intact');
    assert.equal(library.tracks[0].ratingStars, 4, 'ratings are copied into the local index');
    assert.equal(library.tracks[0].favorite, true, 'Favorite tags are copied into the local index');
    assert.equal(library.tracks[0].doNotPlay, true, 'Do Not Play tags are copied into the local index');
    const initialMixAnalysis = await library.analyzeLocalMixes();
    assert.equal(initialMixAnalysis.analyzing, false, 'Local Mix availability analysis completes in the music worker');
    assert.equal(initialMixAnalysis.mixes.length, 49, 'the worker discovers all shipped Local Mix books');
    await fs.access(path.join(dataDir, 'local-mix-availability.json'));
    assert.equal(await digest(), before, 'scanning never changes MP3 bytes');
    assert.equal((await library.call('search', "' OR 1=1 --")).total, 0);
    const indexedSearch = await library.call('search', 'test son');
    assert.equal(indexedSearch.total, 1, 'the main Local Music search uses its indexed multi-word lookup');
    assert.equal(indexedSearch.tracks[0].title, 'Test Song');
    assert.equal(extractTrack({ common: { rating: [{ rating: 0.8 }] }, native: {} }, 'fallback.mp3').ratingStars, 4);
    const tenPointRating = extractTrack({ common: {}, native: { 'ID3v2.4': [{ id: 'TXXX:RATING', value: '5' }] } }, 'five-of-ten.mp3');
    assert.equal(tenPointRating.rating, 5, 'custom RATING remains on the portable 0–10 scale');
    assert.equal(tenPointRating.ratingStars, 2.5, 'custom RATING=5 means 2.5 stars');
    const doNotPlayTag = extractTrack({ common: {}, native: { 'ID3v2.4': [{ id: 'TXXX:DO_NOT_PLAY', value: 'yes' }, { id: 'TXXX:FAVORITE', value: 'true' }] } }, 'skip.mp3');
    assert.equal(doNotPlayTag.doNotPlay, true); assert.equal(doNotPlayTag.favorite, true);
    const opusTag = extractTrack({ common: { title: 'Opus Song', artist: 'Artist' }, native: { vorbis: [{ id: 'RATING', value: '8' }, { id: 'FAVORITE', value: '1' }, { id: 'DO_NOT_PLAY', value: '1' }, { id: 'AMP_TRACK_ID', value: 'wdop_test' }] } }, 'same-song.opus');
    const mp3Tag = extractTrack({ common: { title: 'MP3 Song', artist: 'Artist' }, native: {} }, 'same-song.mp3');
    assert.equal(opusTag.rating, 8, 'Opus Vorbis comments retain WaveDeck’s 0–10 RATING tag');
    assert.equal(opusTag.favorite, true, 'Opus Vorbis comments retain FAVORITE');
    assert.equal(opusTag.doNotPlay, true, 'Opus Vorbis comments retain DO_NOT_PLAY');
    assert.equal(opusTag.id, mp3Tag.id, 'an MP3 and its Opus counterpart keep one Local Music identity');
    assert.equal(OPUS_BITRATE, '96k', 'WaveDeck Opus targets 96 kbps Opus audio');
    const optimizeRoot = path.join(temp, 'opus-portable', 'Music'); const optimizeSource = path.join(optimizeRoot, 'Album', 'song.mp3');
    await fs.mkdir(path.dirname(optimizeSource), { recursive: true }); await fs.writeFile(optimizeSource, fixture());
    await fs.writeFile(path.join(path.dirname(optimizeSource), 'cover.jpg'), 'cover'); await fs.writeFile(path.join(path.dirname(optimizeSource), 'lyrics.lrc'), 'lyrics');
    let optimizerRescans = 0;
    const optimizer = new OpusOptimizer({ musicRoot: optimizeRoot, ffmpegExecutable: 'fake-ffmpeg', ffprobeExecutable: 'fake-ffprobe', rescanLibrary: async () => { optimizerRescans += 1; }, spawnImpl: async (executable, args) => { if (executable === 'fake-ffprobe') return 'opus\n'; await fs.writeFile(args.at(-1), Buffer.alloc(2048, 1)); return ''; } });
    optimizer.parseFile = async () => ({ common: { title: 'Song', artist: 'Artist', album: 'Album', albumartist: 'Artist', track: { no: 1 }, disk: { no: 1 }, year: 1992, genre: ['Rock'] }, native: { 'ID3v2.4': [{ id: 'TXXX:RATING', value: '8' }] } });
    await optimizer.start();
    assert.equal(await fs.access(outputFor(optimizeSource)).then(() => true, () => false), true, 'portable MP3s are atomically replaced with Opus files');
    assert.equal(await fs.access(optimizeSource).then(() => true, () => false), false, 'the source MP3 is removed only after Opus validation');
    assert.equal(await fs.access(path.join(path.dirname(optimizeSource), 'cover.jpg')).then(() => true, () => false), false, 'loose cover art is removed from portable Music');
    assert.equal(await fs.access(path.join(path.dirname(optimizeSource), 'lyrics.lrc')).then(() => true, () => false), false, 'loose lyric files are removed from portable Music');
    assert.equal(optimizerRescans, 1, 'the Local Music index refreshes after an optimization batch');
    assert.equal(optimizer.getStatus().total, 1, 'portable optimization reports its total track count');
    assert.equal(optimizer.getStatus().converted, 1, 'portable optimization reports converted track progress');
    assert.equal(optimizer.getStatus().current, '', 'portable optimization clears its current track after finishing');
    assert.ok(stableAmpId(optimizeRoot, optimizeSource).startsWith('wdop_'), 'converted files receive a stable portable music ID');
    const duplicateRoot = path.join(temp, 'opus-duplicates', 'Music'); const originalDuplicate = path.join(duplicateRoot, 'Artist', 'Album', '01 - Song.opus'); const copiedDuplicate = path.join(duplicateRoot, 'Artist', 'Album', '01 - Song (2).opus');
    await fs.mkdir(path.dirname(originalDuplicate), { recursive: true }); await fs.writeFile(originalDuplicate, Buffer.alloc(2048, 1)); await fs.writeFile(copiedDuplicate, Buffer.alloc(2048, 1));
    const duplicateOptimizer = new OpusOptimizer({ musicRoot: duplicateRoot, ffmpegExecutable: 'fake-ffmpeg', ffprobeExecutable: 'fake-ffprobe', spawnImpl: async executable => executable === 'fake-ffprobe' ? 'opus\n' : '', audioFingerprintImpl: async () => 'same-audio' });
    duplicateOptimizer.parseFile = async () => ({ common: { title: 'Song', artist: 'Artist', album: 'Album', albumartist: 'Artist', track: { no: 1 }, disk: { no: 1 }, year: 1992, genre: ['Rock'] }, native: { 'ID3v2.4': [{ id: 'TXXX:RATING', value: '8' }] } });
    await duplicateOptimizer.start();
    assert.equal(await fs.access(originalDuplicate).then(() => true, () => false), true, 'duplicate cleanup keeps the original unsuffixed Opus file');
    assert.equal(await fs.access(copiedDuplicate).then(() => true, () => false), false, 'duplicate cleanup removes matching copied Opus files');
    const diagnosticRoot = path.join(temp, 'opus-dedup-diagnostics', 'Music'); const firstVariant = path.join(diagnosticRoot, 'Artist', 'Album', '01 - Song.opus'); const secondVariant = path.join(diagnosticRoot, 'Artist', 'Album', '01 - Song (2).opus'); const diagnosticFile = path.join(temp, 'opus-dedup-diagnostics', 'Data', 'opus-dedup-diagnostics.json');
    await fs.mkdir(path.dirname(firstVariant), { recursive: true }); await fs.writeFile(firstVariant, Buffer.alloc(2048, 1)); await fs.writeFile(secondVariant, Buffer.alloc(2048, 1));
    const diagnosticOptimizer = new OpusOptimizer({ musicRoot: diagnosticRoot, diagnosticsPath: diagnosticFile, ffmpegExecutable: 'fake-ffmpeg', ffprobeExecutable: 'fake-ffprobe', spawnImpl: async (executable, args) => { if (executable === 'fake-ffprobe') return 'opus\n'; await fs.writeFile(args.at(-1), Buffer.alloc(2048, 1)); return ''; }, audioFingerprintImpl: async (_executable, file) => path.basename(file).includes('(2)') ? 'second-source-encoding' : 'first-source-encoding' });
    diagnosticOptimizer.parseFile = async file => ({ common: { title: 'Song', artist: 'Artist', album: 'Album', albumartist: file === firstVariant ? '' : 'Artist', track: { no: 1 }, disk: { no: file === firstVariant ? 0 : 1 }, year: 1992, genre: ['Rock'] }, native: { 'ID3v2.4': [{ id: 'TXXX:RATING', value: file === firstVariant ? '3' : '9' }, { id: 'TXXX:FAVORITE', value: file === secondVariant ? '1' : '0' }] } });
    await diagnosticOptimizer.start();
    assert.equal(await fs.access(firstVariant).then(() => true, () => false), true, 'same-release copies keep the original unsuffixed Opus file');
    assert.equal(await fs.access(secondVariant).then(() => true, () => false), false, 'same-release copies are cleaned even when old source encodes differ');
    const diagnosticReport = JSON.parse(await fs.readFile(diagnosticFile, 'utf8'));
    assert.equal(diagnosticReport.lastRun.removed, 1, 'duplicate cleanup records the number of physical copies removed');
    assert.ok(diagnosticReport.lastRun.groups.some(group => group.type === 'same-release-tags-different-audio' && group.action === 'removed' && group.merged?.rating === 9), 'diagnostics explain the kept same-release copy and merged personal tags');
    assert.equal(radioArtist(track('x', { albumArtist: 'Various Artists', artist: 'Solo' })), 'Solo');

    const savedTracks = []; const savedArtists = [];
    const lastFmLibrary = { enabled: true, worker: {}, getLastFmStatus: async () => ({ tracksTotal: 1, tracksCurrent: 0, queuedAlbums: 1 }), nextLastFmAlbum: async () => ({ albumKey: 'artist\\nalbum', queued: true, tracks: [track('lastfm')], artists: ['Artist'] }), updateLastFmTrack: async value => savedTracks.push(value), updateLastFmArtist: async value => savedArtists.push(value), applyLastFmTrack: () => {}, applyLastFmArtist: () => {}, completeLastFmAlbum: async () => {} };
    const enricher = new LastFmEnricher({ library: lastFmLibrary, getPreferences: () => ({ lastFmEnabled: true, lastFmApiKey: 'key' }), requestIntervalMs: 0, fetchImpl: async url => ({ ok: true, json: async () => url.includes('track.getInfo') ? { track: { listeners: '100000', toptags: { tag: [{ name: 'Progressive Rock' }] } } } : { similarartists: { artist: [{ name: 'David Gilmour' }] } } }) });
    await enricher.tick(); enricher.stop(); assert(savedTracks[0].popularity > 0 && savedArtists[0].similarArtists.includes('David Gilmour')); assert(popularityScore(100000) > popularityScore(1000));
    assert.match(signatureFor({ b: '2', a: '1' }, 'test-secret'), /^[a-f0-9]{32}$/, 'Last.fm write calls use a stable signed request');
    const scrobbleRequests = [];
    const scrobbler = new LastFmScrobbler({ dataDir: path.join(temp, 'lastfm-scrobble'), now: () => 1_000_000, fetchImpl: async (url, options = {}) => {
      scrobbleRequests.push({ url, options }); return { ok: true, json: async () => ({ scrobbles: { accepted: '1' } }) };
    } });
    scrobbler.data.sessionKey = 'a'.repeat(32); scrobbler.data.username = 'Andrew';
    scrobbler.trackStarted(track('scrobble', { title: 'Scrobble Song', artist: 'Scrobble Artist', duration: 240 }));
    scrobbler.observe({ mediaState: 'playing', position: 120, duration: 240, currentMusic: { track: { id: 'scrobble' } } });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(scrobbleRequests.some(request => String(request.options.body || '').includes('method=track.scrobble')), 'Local Music queues and submits a scrobble after genuine listening');
    assert.equal(scrobbler.getStatus().pending, 0, 'accepted scrobbles leave the offline queue');
    scrobbler.stop();

    let now = 10_000_000;
    const seed = track('comfortably-numb', { title: 'Comfortably Numb', artist: 'Pink Floyd', artists: ['Pink Floyd'], albumArtist: 'Pink Floyd', album: 'The Wall', genres: ['Progressive Rock', 'Rock'], similarArtists: ['David Gilmour'] });
    const sameAlbum = track('run-like-hell', { title: 'Run Like Hell', artist: 'Pink Floyd', artists: ['Pink Floyd'], albumArtist: 'Pink Floyd', album: 'The Wall', genres: ['Rock'], ratingStars: 5 });
    const seedArtist = track('wish-you-were-here', { artist: 'Pink Floyd', artists: ['Pink Floyd'], albumArtist: 'Pink Floyd', album: 'Wish You Were Here', genres: ['Rock'] });
    const similar = track('gilmour', { artist: 'David Gilmour', artists: ['David Gilmour'], album: 'About Face', genres: ['Rock'] });
    const specificTag = track('prog', { artist: 'King Crimson', artists: ['King Crimson'], album: 'Red', genres: ['Progressive Rock'] });
    const country = track('devil', { title: 'The Devil Went Down to Georgia', artist: 'Charlie Daniels Band', artists: ['Charlie Daniels Band'], album: 'Million Mile Reflections', genres: ['Country', 'Rock'] });
    const radio = new MusicRadio({ dataDir, now: () => now, random: () => 0 });
    const diagnosticSelections = [];
    const diagnosticRadio = new MusicRadio({ dataDir: path.join(temp, 'persistent-diagnostics'), now: () => now, random: () => 0, onDecision: decision => diagnosticSelections.push(decision) });
    assert.equal(diagnosticRadio.choose([sameAlbum], seed, 'radio').id, sameAlbum.id);
    assert.equal(diagnosticSelections.length, 1, 'Local Radio records every selection through its diagnostic callback without requiring a visible log window');
    diagnosticRadio.recordManualStart(seed, 'radio', 'radio:comfortably-numb');
    assert.equal(diagnosticSelections.length, 2, 'The selected opening Song Radio track is recorded in diagnostics');
    assert.equal(diagnosticSelections.at(-1).selectionTrigger, 'start');
    assert.equal(diagnosticSelections.at(-1).selected.title, 'Comfortably Numb');
    assert.equal(radio.choose([country], seed, 'radio'), null, 'a broad Rock tag alone is never enough');
    assert.equal(radio.choose([sameAlbum, country], seed, 'radio').id, sameAlbum.id, 'same-album songs lead Song Radio');
    const exploreSeed = track('explore-seed', { artist: 'Seed Artist', artists: ['Seed Artist'], albumArtist: 'Seed Artist', similarArtists: ['First Neighbor'] });
    const exploreFirst = track('explore-first', { artist: 'First Neighbor', artists: ['First Neighbor'], albumArtist: 'First Neighbor', similarArtists: ['Second Neighbor'] });
    const exploreSecond = track('explore-second', { artist: 'Second Neighbor', artists: ['Second Neighbor'], albumArtist: 'Second Neighbor', similarArtists: ['Seed Artist'] });
    const exploreRadio = new MusicRadio({ dataDir: path.join(temp, 'explore-radio'), now: () => now, random: () => 0, getTuning: () => ({ localRadioExploreDistance: 'detour' }) });
    exploreRadio.beginExploreSession(exploreSeed); exploreRadio.record(exploreSeed);
    assert.equal(exploreRadio.choose([exploreFirst, exploreSecond], exploreSeed, 'explore').id, 'explore-first', 'Explore Radio starts from a direct neighbor of the seed');
    exploreRadio.record(exploreFirst);
    assert.equal(exploreRadio.choose([exploreFirst, exploreSecond], exploreSeed, 'explore').id, 'explore-second', 'Explore Radio daisy-chains through the current related artist');
    const rescueRoot = track('rescue-root', { artist: 'Root Artist', artists: ['Root Artist'], albumArtist: 'Root Artist', similarArtists: ['Blocked Branch', 'Rescue Branch'] });
    const blockedBranch = track('blocked-branch', { artist: 'Blocked Branch', artists: ['Blocked Branch'], albumArtist: 'Blocked Branch', similarArtists: ['Stuck Branch'] });
    const stuckBranch = track('stuck-branch', { artist: 'Stuck Branch', artists: ['Stuck Branch'], albumArtist: 'Stuck Branch', similarArtists: ['Blocked Branch'] });
    const rescueBranch = track('rescue-branch', { artist: 'Rescue Branch', artists: ['Rescue Branch'], albumArtist: 'Rescue Branch', similarArtists: ['Root Artist'] });
    const rescueRadio = new MusicRadio({ dataDir: path.join(temp, 'explore-rescue'), now: () => now, random: () => 0, getTuning: () => ({ localRadioExploreDistance: 'explore', artistRepeatMinutes: 180 }) });
    rescueRadio.beginSession(); rescueRadio.beginExploreSession(rescueRoot); rescueRadio.record(blockedBranch); rescueRadio.record(stuckBranch);
    rescueRadio.exploreStation.current = { ...stuckBranch }; rescueRadio.exploreStation.hops = 2;
    assert.equal(rescueRadio.choose([blockedBranch, stuckBranch, rescueBranch], rescueRoot, 'explore').id, rescueBranch.id, 'Explore Radio uses a nearby unblocked related-artist route when its current path runs dry');
    assert.equal(rescueRadio.getLastDecision().explore.rescueUsed, true, 'Explore Radio diagnostics identify a rescue route');
    assert.equal(rescueRadio.isExploringAwayFromSeed(), true, 'Explore Radio exposes when the current route is away from its original seed');
    assert(weight(seedArtist, seed, 'artist', [], now) > weight(similar, seed, 'artist', [], now), 'Artist Radio returns to seed artist');
    assert(weight(similar, seed, 'artist', [], now) > 0 && weight(specificTag, seed, 'radio', [], now) > 0, 'Last.fm and specific tags are meaningful links');
    assert.equal(weight(country, seed, 'radio', [], now), 0);
    assert(weight(track('rated', { artist: 'Pink Floyd', artists: ['Pink Floyd'], ratingStars: 5 }), seed, 'artist', [], now) > weight(track('unrated', { artist: 'Pink Floyd', artists: ['Pink Floyd'] }), seed, 'artist', [], now));
    const hit = track('hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Animals', popularity: 100 });
    const deepCut = track('deep-cut', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Obscured by Clouds', popularity: 0 });
    assert(weight(hit, seed, 'artist', [], now, null, 'hits') > weight(deepCut, seed, 'artist', [], now, null, 'hits'), 'Favor the Hits prefers credible popular songs');
    assert(weight(deepCut, seed, 'artist', [], now, null, 'deep-cuts') > weight(hit, seed, 'artist', [], now, null, 'deep-cuts'), 'Play Deep Cuts Too favors credible lesser-known songs');
    const familiarityRadio = new MusicRadio({ dataDir: path.join(temp, 'familiarity'), now: () => now, random: () => 0, getFamiliarity: () => 'hits' });
    assert.equal(familiarityRadio.choose([hit, deepCut], seed, 'radio').id, hit.id);
    assert.equal(familiarityRadio.getLastDecision().familiarity, 'hits');
    const favoriteDeepCut = track('favorite-deep-cut', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'More', popularity: 0, favorite: true });
    const lowRatedHit = track('low-rated-hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'The Division Bell', popularity: 100, ratingStars: 1 });
    const personalizedHits = new MusicRadio({ dataDir: path.join(temp, 'personalized-hits'), now: () => now, random: () => 0 });
    assert.equal(personalizedHits.choose([favoriteDeepCut, lowRatedHit], seed, 'radio').id, favoriteDeepCut.id, 'Favorite tags outrank public popularity in Favor the Hits');
    const unratedPopular = track('unrated-popular', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'A Momentary Lapse of Reason', popularity: 100 });
    const ratedSix = track('rated-six', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Meddle', popularity: 0, rating: 6, ratingStars: 3 });
    const ratedSeven = track('rated-seven', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'The Dark Side of the Moon', popularity: 0, rating: 7, ratingStars: 3.5 });
    const ratedTen = track('rated-ten', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'Wish You Were Here', popularity: 0, rating: 10, ratingStars: 5 });
    const personalPoolRadio = new MusicRadio({ dataDir: path.join(temp, 'personal-pool'), now: () => now, random: () => 0.99, getFamiliarity: () => 'hits' });
    const personalPoolPick = personalPoolRadio.choose([unratedPopular, ratedSix, ratedSeven, ratedTen], seed, 'radio');
    assert(['rated-seven', 'rated-ten'].includes(personalPoolPick.id), 'Favor the Hits excludes unrated and 6/10 songs when 7–10 songs are available');
    assert.equal(personalPoolRadio.getLastDecision().counts.personal, 2, 'diagnostics identify the personal pool');
    assert.equal(personalPoolRadio.getLastDecision().counts.lastFmFamiliar, 0, 'Last.fm does not dilute an available personal pool');
    const balancedPoolRadio = new MusicRadio({ dataDir: path.join(temp, 'balanced-pool'), now: () => now, random: () => 0, getFamiliarity: () => 'balanced' });
    assert(['rated-six', 'rated-seven', 'rated-ten'].includes(balancedPoolRadio.choose([unratedPopular, ratedSix, ratedSeven, ratedTen], seed, 'radio').id), 'Balanced Mix uses its 5–10 personal pool');
    const deepPoolRadio = new MusicRadio({ dataDir: path.join(temp, 'deep-pool'), now: () => now, random: () => 0, getFamiliarity: () => 'deep-cuts' });
    const ratedThree = track('rated-three', { artist: 'Pink Floyd', artists: ['Pink Floyd'], album: 'More', popularity: 0, rating: 3, ratingStars: 1.5 });
    assert.equal(deepPoolRadio.choose([unratedPopular, ratedThree, ratedTen], seed, 'radio').id, ratedThree.id, 'Play Deep Cuts Too keeps 3/10 music in the personal pool');
    const blockedHit = track('blocked-hit', { artist: 'Pink Floyd', artists: ['Pink Floyd'], popularity: 100, ratingStars: 5, favorite: true, doNotPlay: true });
    assert.equal(personalizedHits.choose([blockedHit, hit], seed, 'radio').id, hit.id, 'Do Not Play blocks even a favorite high-rated hit');
    assert.equal(personalizedHits.getLastDecision().counts.skippedForDoNotPlay, 1);

    const metallica = Array.from({ length: 10 }, (_value, index) => track(`metallica-${index}`, {
      artist: 'Metallica', artists: ['Metallica'], albumArtist: 'Metallica', album: `Metallica ${index}`, rating: index % 2 ? 8 : 4
    }));
    const metallicaSeed = metallica[0];
    metallicaSeed.similarArtists = ['Megadeth'];
    const megadeth = track('megadeth', { artist: 'Megadeth', artists: ['Megadeth'], albumArtist: 'Megadeth', album: 'Rust in Peace' });
    const artistStationRadio = new MusicRadio({ dataDir: path.join(temp, 'true-artist-radio'), now: () => now, random: () => 0, getFamiliarity: () => 'hits' });
    artistStationRadio.beginArtistSession(metallicaSeed);
    for (let index = 0; index < 8; index++) {
      const picked = artistStationRadio.choose([...metallica, megadeth], metallicaSeed, 'artist');
      assert.equal(picked.artist, 'Metallica', 'Artist Radio holds to the selected artist for its first 90% lane');
      artistStationRadio.record(picked);
    }
    assert.equal(artistStationRadio.choose([...metallica, megadeth], metallicaSeed, 'artist').artist, 'Megadeth', 'Artist Radio permits one related-artist palate change after nine Metallica selections');
    assert.equal(artistStationRadio.getLastDecision().artistRadio.seedTargetPercent, 90);
    assert.equal(artistStationRadio.getLastDecision().familiarity, 'balanced', 'Artist Radio has a fixed taste profile rather than following Song Familiarity');
    const sparseArtistRadio = new MusicRadio({ dataDir: path.join(temp, 'sparse-artist-radio'), now: () => now, random: () => 0 });
    sparseArtistRadio.beginArtistSession(metallicaSeed);
    assert.equal(sparseArtistRadio.choose([megadeth], metallicaSeed, 'artist'), null, 'Artist Radio waits instead of substituting related music when no seed-artist track is eligible');
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
    artistWaitRadio.beginSession();
    assert.equal(artistWaitRadio.choose([rotationB], seed, 'radio').id, rotationB.id, 'starting a new Local Radio station resets artist rest while retaining exact-song history');
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
    const copiedMixIds = listLocalMixes(portableMixData).map(mix => mix.id);
    assert.equal(copiedMixIds.length, 49, 'all shipped Local Mix books copy to portable Data');
    assert(copiedMixIds.includes('classic-rock') && copiedMixIds.includes('christian-gospel') && copiedMixIds.includes('ambient-chill'), 'the expanded built-in Local Mix books copy to portable Data');
    let mixAvailability = getLocalMixAvailability(portableMixData, classicSeedTracks);
    const classicAvailability = mixAvailability.find(mix => mix.id === 'classic-rock');
    assert.equal(classicAvailability.ready, true, 'Local Mixes need at least twenty eligible songs before they can appear');
    assert.equal(classicAvailability.enabled, true, 'shipped Local Mixes are available by default');
    await fs.writeFile(path.join(portableMixData, 'local-mixes', 'outside-book.json'), JSON.stringify({ id: 'outside-book', name: 'Outside Book', description: 'Test optional book', coreArtists: ['Boston'] }));
    mixAvailability = getLocalMixAvailability(portableMixData, classicSeedTracks);
    assert.equal(mixAvailability.find(mix => mix.id === 'outside-book').enabled, false, 'new externally added Local Mix books start hidden');
    await fs.writeFile(path.join(portableMixData, 'local-mixes', 'holiday-christmas.json'), JSON.stringify({ id: 'holiday-christmas', name: 'Holiday & Christmas', description: 'Holiday tag test', coreArtists: ['The Beach Boys'], formatPolicy: { genreTags: ['Christmas', 'Holiday', 'Xmas'] } }));
    const holidayMix = loadLocalMixes(portableMixData).find(mix => mix.id === 'holiday-christmas');
    assert.equal(isTrackEligibleForMix(track('holiday-tagged', { artist: 'Unknown Artist', genres: ['Christmas Music'], year: 2020 }), holidayMix).eligible, true, 'Holiday & Christmas admits an explicit Christmas genre tag');
    assert.equal(isTrackEligibleForMix(track('not-holiday', { artist: 'The Beach Boys', genres: ['Pop'], year: 1966 }), holidayMix).eligible, false, 'Holiday & Christmas never admits an ordinary song by a listed artist');
    const classicMix = resolveLocalMix('classic-rock', classicSeedTracks, portableMixData);
    assert.equal(classicMix.seeds.length, 4, 'Classic Rock resolves its curated seed tracks from the Local Music library');
    assert.equal(isTrackEligibleForMix(track('early-beatles', { artist: 'The Beatles', title: 'Act Naturally', year: 1965 }), classicMix).eligible, false, 'Classic Rock rejects early Beatles');
    assert.equal(isTrackEligibleForMix(track('late-aerosmith', { artist: 'Aerosmith', title: 'Under My Skin', year: 2001 }), classicMix).eligible, false, 'Classic Rock rejects post-format Aerosmith');
    assert.equal(isTrackEligibleForMix(track('black-ice', { artist: 'AC/DC', title: 'Rock ’n’ Roll Train', year: 2008 }), classicMix).eligible, true, 'Classic Rock keeps later AC/DC eligible');
    assert.equal(isTrackEligibleForMix(classicSeedTracks[0], classicMix).eligible, true, 'Classic Rock keeps its intended core material');
    const bestMix = resolveLocalMix('your-best-music', classicSeedTracks, portableMixData);
    assert.equal(bestMix.name, 'Wild Card Radio', 'the seedless personal Local Mix has its listener-facing name');
    assert.equal(isTrackEligibleForMix(track('anything', { artist: 'Miles Davis', genres: ['Jazz'] }), bestMix).eligible, true, 'Wild Card Radio can use any artist in the personal library');
    const bestMixRadio = new MusicRadio({ dataDir: path.join(temp, 'best-music-format'), now: () => now, random: () => 0, getFamiliarity: () => 'hits' });
    const ratedFavorite = track('best-rated', { artist: 'Metallica', artists: ['Metallica'], rating: 8, popularity: 5 });
    const bestMixPopular = track('best-popular', { artist: 'Miles Davis', artists: ['Miles Davis'], popularity: 95 });
    assert.equal(bestMixRadio.choose([ratedFavorite, bestMixPopular], bestMix, 'mix').id, ratedFavorite.id, 'Wild Card Radio uses personal ratings before Last.fm popularity');
    const fallbackRadio = new MusicRadio({ dataDir: path.join(temp, 'best-music-fallback'), now: () => now, random: () => 0, getFamiliarity: () => 'balanced' });
    assert.equal(fallbackRadio.choose([bestMixPopular, track('unrated-obscure', { artist: 'Frank Zappa', artists: ['Frank Zappa'], popularity: 10 })], bestMix, 'mix').id, bestMixPopular.id, 'Wild Card Radio falls back to Last.fm familiarity when no personal ratings or Favorites exist');
    const lastFmOnlyMixRadio = new MusicRadio({ dataDir: path.join(temp, 'lastfm-only-mix'), now: () => now, random: () => 0.99, getTuning: () => ({ localMixFavorLastFm: true }) });
    const favoriteLowPopularity = track('favorite-low-popularity', { artist: 'Metallica', artists: ['Metallica'], favorite: true, rating: 10, popularity: 5 });
    const highPopularity = track('high-popularity', { artist: 'Miles Davis', artists: ['Miles Davis'], rating: 1, popularity: 95 });
    const missingPopularity = track('missing-popularity', { artist: 'David Bowie', artists: ['David Bowie'], favorite: true, rating: 10 });
    assert.equal(lastFmOnlyMixRadio.choose([favoriteLowPopularity, highPopularity, missingPopularity], bestMix, 'mix').id, highPopularity.id, 'Favor Last.fm Data for Local Mixes ignores ratings and Favorites, excludes missing Last.fm data, and selects by popularity');
    assert.equal(lastFmOnlyMixRadio.getLastDecision().reason.includes('Last.fm popularity'), true, 'Local Mix diagnostics identify strict Last.fm popularity mode');
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
    const tracks = [track('2', { track: 2 }), track('1'), track('3', { album: 'Other' }), track('blocked', { doNotPlay: true }), track('va-1', { album: 'Hits', albumArtist: 'Various Artists', artist: 'Artist One', artists: ['Artist One'] }), track('va-2', { track: 2, album: 'Hits', albumArtist: 'Various Artists', artist: 'Artist Two', artists: ['Artist Two'] })]; const fakeLibrary = { tracks, resolve: async id => { const found = tracks.find(t => t.id === id); if (!found) throw Error('missing'); return { ...found, path: '/' + id }; } };
    const playbackDiagnostics = [];
    const controller = serializeTransport(new MediaController({ player, getStations: () => [{ id: 's', url: 'https://example.org', name: 'Streaming', preset: true }] })); controller.configureMusic(fakeLibrary, new MusicRadio({ dataDir: path.join(temp, 'playback'), now: () => now, onDecision: decision => playbackDiagnostics.push(decision) }));
    await controller.playMusic('2', 'album'); assert.equal(controller.getStatus().currentMusic.track.id, '1'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.track.id, '2'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.mode, 'artist'); await controller.playMusic('va-1', 'album'); assert.equal(controller.getStatus().currentMusic.track.id, 'va-1'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.track.id, 'va-2'); await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic, null, 'Various Artists albums stop when the album ends'); await controller.playMusic('1', 'radio'); assert.equal(controller.getStatus().currentMusic.seed.id, '1'); assert.equal(playbackDiagnostics.at(-1).selectionTrigger, 'start', 'Song Radio logs its opening seed track after playback begins'); await assert.rejects(controller.playMusic('blocked', 'radio'), /marked Do Not Play/); await controller.playStationById('s'); assert.equal(controller.getStatus().currentMusic, null);
    let position = 0; const crossfades = [];
    const crossfadePlayer = {
      isCrossfading: false,
      getStatus: () => ({ playing: true, position, duration: 2 }),
      setStationGain: async () => {}, play: async () => {}, stop: async () => {}, setPaused: async () => {}, seek: async () => {},
      crossfadeTo: async (file, duration) => { crossfades.push({ file, duration }); position = 0; }
    };
    const crossfadeTracks = [
      track('crossfade-a', { artist: 'Crossfade Artist', artists: ['Crossfade Artist'], albumArtist: 'Crossfade Artist', duration: 2 }),
      track('crossfade-b', { artist: 'Crossfade Artist', artists: ['Crossfade Artist'], albumArtist: 'Crossfade Artist', duration: 2 })
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
