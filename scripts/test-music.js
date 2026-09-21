const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { MusicLibrary } = require('../src/main/music-library');
const { MusicRadio, weight, COOLDOWN, RULE_FILES } = require('../src/main/music-radio');
const { extractTrack, radioArtist } = require('../src/main/music-tags');
const { MediaController, serializeTransport } = require('../src/main/media-controller');

function fixture() {
  const frame = (id, value) => {
    const data = Buffer.concat([Buffer.from([0]), Buffer.from(value)]);
    const header = Buffer.alloc(10); header.write(id); header.writeUInt32BE(data.length, 4);
    return Buffer.concat([header, data]);
  };
  const body = Buffer.concat([frame('TIT2', 'Test Song'), frame('TPE1', 'Artist'), frame('TALB', 'Album'),
    frame('TCON', 'Pop'), frame('TXXX', 'RATING\0' + '8'), frame('TXXX', 'PLAYCOUNT\0' + '12')]);
  const header = Buffer.from([73,68,51,3,0,0,0,0,0,0]);
  let size = body.length; for (let i = 9; i >= 6; i--) { header[i] = size & 127; size >>= 7; }
  const audio = Buffer.alloc(417); Buffer.from([255,251,144,100]).copy(audio);
  return Buffer.concat([header, body, ...Array.from({ length: 100 }, () => audio)]);
}
function track(id, more = {}) {
  return { id, songKey: id, title: id, artist: 'Artist', artists: ['Artist'], albumArtist: 'Artist',
    album: 'Album', track: Number(id) || 1, disc: 1, relativePath: id + '.mp3',
    genres: ['Pop'], moods: [], similarArtists: [], year: 1986, rating: null, ...more };
}
async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wavedeck-music-test-'));
  let library;
  try {
    const dataDir = path.join(temp, 'Data');
    const musicDir = path.join(temp, 'Music', 'nested');
    await fs.mkdir(musicDir, { recursive: true });
    const file = path.join(musicDir, 'song.MP3');
    await fs.writeFile(file, fixture());
    const digest = async () => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    const before = await digest();
    library = new MusicLibrary({ dataDir });
    await library.enable(); await library.rescan();
    assert.equal(library.tracks.length, 1);
    assert.equal(library.tracks[0].rating, 8); assert.equal(library.tracks[0].playCount, 12);
    assert.equal((await library.call('search', 'artist song')).total, 1);
    assert.equal((await library.call('search', "' OR 1=1 --")).total, 0);
    assert.equal((await library.resolve(library.tracks[0].id)).path, file);
    assert.equal(await digest(), before, 'scanning must not change MP3 bytes');
    assert.equal((await fs.readFile(path.join(dataDir, 'music.sqlite'))).subarray(0,15).toString(), 'SQLite format 3');
    await fs.rename(file, path.join(musicDir, 'renamed.mp3'));
    await library.rescan(); assert.equal(library.tracks.length, 1); assert.match(library.tracks[0].relativePath, /renamed/);
    await fs.unlink(path.join(musicDir, 'renamed.mp3')); await library.rescan(); assert.equal(library.tracks.length, 0);
    const externalDir = path.join(temp, 'Elsewhere');
    const externalFile = path.join(externalDir, 'external.mp3');
    await fs.mkdir(externalDir, { recursive: true }); await fs.writeFile(externalFile, fixture());
    await library.setAdditionalMusicFolder(externalDir); await library.rescan();
    assert.equal(library.tracks.length, 1); assert.equal(library.tracks[0].library, 'additional');
    assert.equal((await library.resolve(library.tracks[0].id)).path, externalFile);
    const tag = extractTrack({ common: { rating: [{ rating: 0.8 }] }, native: {} }, 'fallback.mp3');
    assert.equal(tag.title, 'fallback'); assert.equal(tag.rating, 8);
    assert.equal(radioArtist(track('x', { albumArtist: 'Various Artists', artist: 'Solo' })), 'Solo');
    assert.equal(radioArtist(track('x', { album: 'Film Soundtrack', albumArtist: 'Studio', artist: 'Solo' })), 'Solo');

    let now = 10_000_000;
    let seed = 42;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    const radio = new MusicRadio({ dataDir, now: () => now, random });
    assert.equal(await fs.readFile(path.join(dataDir, RULE_FILES.artist), 'utf8').then(JSON.parse).then(value => value.repeatCooldownMinutes), 120);
    assert.match(await fs.readFile(path.join(dataDir, 'music-radio-rules-reference.txt'), 'utf8'), /Artist Radio/);
    const catalog = Array.from({ length: 150 }, (_, i) => track(String(i), { artist: `Artist ${i % 20}`, artists: [`Artist ${i % 20}`] }));
    const low = track('low', { rating: 2 });
    assert.equal(weight(low, catalog[0], 'artist', [], now), 0);
    assert(weight(track('rare', { rating: 4 }), catalog[0], 'artist', [], now) < weight(track('normal'), catalog[0], 'artist', [], now) / 5);
    const seen = new Map(); const sequence = [];
    for (let i = 0; i < 1200; i++) {
      const picked = radio.choose([...catalog, low], catalog[0], 'radio'); assert(picked);
      if (seen.has(picked.songKey)) assert(now - seen.get(picked.songKey) >= COOLDOWN);
      assert.notEqual(picked.id, 'low'); seen.set(picked.songKey, now); sequence.push(picked.id);
      radio.record(picked); now += 180000;
    }
    assert(seen.size > 100, 'deep cuts should get airtime');
    assert.notDeepEqual(sequence.slice(0, 40), sequence.slice(40, 80));
    const editableDir = path.join(temp, 'editable-rules');
    const editableRadio = new MusicRadio({ dataDir: editableDir, now: () => now, random });
    const editableRules = JSON.parse(await fs.readFile(path.join(editableDir, RULE_FILES.artist), 'utf8'));
    editableRules.sameArtistWeight = 15;
    editableRules.repeatCooldownMinutes = 1;
    await fs.writeFile(path.join(editableDir, RULE_FILES.artist), JSON.stringify(editableRules));
    assert(editableRadio.choose(catalog, catalog[0], 'artist'));
    assert.equal(editableRadio.rules.artist.sameArtistWeight, 15);
    assert.equal(editableRadio.rules.artist.repeatCooldownMinutes, 120, 'repeat protection cannot be tuned below two hours');
    await fs.writeFile(path.join(editableDir, RULE_FILES.radio), '{not valid json');
    const previousWarning = console.warn; console.warn = () => {};
    try { assert(editableRadio.choose(catalog, catalog[0], 'radio'), 'invalid rules must fall back safely'); }
    finally { console.warn = previousWarning; }
    const reloaded = new MusicRadio({ dataDir, now: () => now });
    assert.equal(weight(catalog.find(t => t.id === sequence.at(-1)), catalog[0], 'radio', reloaded.history, now), 0);
    const tiny = new MusicRadio({ dataDir: path.join(temp, 'tiny'), now: () => now });
    tiny.record(catalog[0]); assert.equal(tiny.choose([catalog[0]], catalog[0], 'artist'), null);
    now += COOLDOWN; assert(tiny.choose([catalog[0]], catalog[0], 'artist'));

    const calls = [];
    const player = { getStatus: () => ({ playing: true, position: 0 }),
      setStationGain: async n => calls.push(['gain', n]), play: async p => calls.push(['play', p]),
      stop: async () => calls.push(['stop']), setPaused: async p => calls.push(['pause', p]), seek: async p => calls.push(['seek', p]) };
    const tracks = [track('2', { track: 2 }), track('1'), track('3', { album: 'Other' })];
    const fakeLibrary = { tracks, resolve: async id => { const found = tracks.find(t => t.id === id); if (!found) throw Error('missing'); return { ...found, path: '/' + id }; } };
    const controller = serializeTransport(new MediaController({ player, getStations: () => [{ id: 's', url: 'https://example.org', name: 'Radio', preset: true }] }));
    controller.configureMusic(fakeLibrary, new MusicRadio({ dataDir: path.join(temp, 'playback'), now: () => now }));
    await controller.playMusic('2', 'album'); assert.equal(controller.getStatus().currentMusic.track.id, '1');
    assert.equal(controller.getStatus().currentMusic.label, 'Album Radio');
    await controller.pause(); assert.deepEqual(calls.at(-1), ['pause', true]);
    await controller.play(); assert.deepEqual(calls.at(-1), ['pause', false]);
    await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.track.id, '2');
    await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.mode, 'artist');
    assert.equal(controller.getStatus().currentMusic.track.id, '3');
    assert.equal(controller.getStatus().currentMusic.label, 'Artist Radio');
    await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getStatus().currentMusic.waiting, true);
    await controller.stop(); assert.equal(controller.getStatus().currentMusic, null);
    await controller.playMusic('1', 'radio'); assert.equal(controller.getStatus().currentMusic.track.id, '1', 'explicit seed overrides cooldown');
    assert.equal(controller.getStatus().currentMusic.label, '1 Radio');
    await controller.playStationById('s'); assert.equal(controller.getStatus().currentMusic, null);
    await controller.handleEnded({ reason: 'eof' }); assert.equal(controller.getCurrentStation().id, 's');
    await Promise.all([controller.playMusic('1', 'song'), controller.playStationById('s')]); assert.equal(controller.getCurrentStation().id, 's');
    console.log('Music tests passed: SQLite scan/search, unchanged MP3s, rating mappings, 60-hour radio simulation, restart cooldown, album handoff, pause, waiting and source switching.');
  } finally {
    library?.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
