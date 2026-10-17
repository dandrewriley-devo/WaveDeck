const fs = require('fs');
const path = require('path');
const { normalize, compilation, radioArtist } = require('./music-tags');
const { resolveLocalMix } = require('./local-mixes');
function sortByName(a, b) {
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), undefined, {
    sensitivity: "base"
  });
}

function presetRank(station) {
  const raw = station?.presetOrder;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sortPresets(a, b) {
  const aRank = presetRank(a);
  const bRank = presetRank(b);
  if (aRank !== null && bRank !== null && aRank !== bRank) return aRank - bRank;
  if (aRank !== null && bRank === null) return -1;
  if (aRank === null && bRank !== null) return 1;
  return sortByName(a, b);
}

function publicStation(station) {
  if (!station) return null;
  return {
    id: String(station.id ?? ""),
    name: String(station.name ?? ""),
    url: String(station.url ?? ""),
    country: String(station.country ?? ""),
    description: String(station.description ?? ""),
    subgroup: String(station.subgroup ?? ""),
    favorite: Boolean(station.favorite),
    preset: Boolean(station.preset),
    hasPreRoll: Boolean(station.hasPreRoll),
    gainDb: Number.isFinite(Number(station.gainDb)) ? Number(station.gainDb) : 0
  };
}

function publicRecording(recording) {
  if (!recording) return null;
  return {
    id: String(recording.id ?? ""),
    fileName: String(recording.fileName ?? ""),
    name: String(recording.name ?? "WaveDeck Recording"),
    modifiedAt: String(recording.modifiedAt ?? ""),
    size: Number(recording.size) || 0,
    durationSeconds: Number.isFinite(Number(recording.durationSeconds))
      ? Number(recording.durationSeconds)
      : null
  };
}

function musicContextLabel(music) {
  if (music?.mode === 'mix') return music?.label || music?.seed?.title || 'Local Mix';
  const seed = music?.seed || music?.current || {};
  if (music?.mode === 'album') return seed.album ? `${seed.album} Radio` : 'Album Radio';
  if (music?.mode === 'artist') return `${radioArtist(seed) || seed.artist || 'Artist'} Radio`;
  if (music?.mode === 'explore') return seed.title ? `${seed.title} Explore Radio` : 'Explore Radio';
  if (music?.mode === 'radio') return seed.title ? `${seed.title} Radio` : 'Song Radio';
  return seed.title || 'Song';
}

function artistRadioSeedForAlbum(track) {
  if (compilation(track)) return null;
  const artist = radioArtist(track);
  if (!artist) return null;
  return { ...track, artist, albumArtist: artist, artists: [artist] };
}

class MediaController {
  constructor({
    player,
    getStations,
    onStationChanged,
    onStateChanged,
    beforeStationChange,
    beforeStop,
    dataDir = '',
    getCrossfadeEnabled = () => false,
    getFinishCurrentSongOnStationChange = () => false,
    getLocalStationProfile = () => null,
    onLocalStationStart = () => {},
    onStationIdPlayed = () => {},
    now = () => Date.now(),
    random = Math.random
  }) {
    this.player = player;
    this.getStations = getStations;
    this.onStationChanged = onStationChanged || (() => {});
    this.onStateChanged = onStateChanged || (() => {});
    this.beforeStationChange = beforeStationChange || (async () => {});
    this.beforeStop = beforeStop || (async () => {});
    this.dataDir = dataDir;
    this.getCrossfadeEnabled = getCrossfadeEnabled;
    this.getFinishCurrentSongOnStationChange = getFinishCurrentSongOnStationChange;
    this.getLocalStationProfile = getLocalStationProfile;
    this.onLocalStationStart = onLocalStationStart;
    this.onStationIdPlayed = onStationIdPlayed;
    this.now = now;
    this.random = random;
    this.stationIdsDir = dataDir ? path.join(path.dirname(dataDir), 'Station IDs') : '';
    this.stationIdDirectories = this.stationIdsDir ? {
      half: path.join(this.stationIdsDir, 'Half Hour'),
      hour: path.join(this.stationIdsDir, 'Top of Hour')
    } : {};
    if (this.stationIdsDir) {
      try {
        fs.mkdirSync(this.stationIdDirectories.half, { recursive: true });
        fs.mkdirSync(this.stationIdDirectories.hour, { recursive: true });
      } catch {}
    }
    this.stationIdPlaying = null;
    this.stationIdQueued = null;
    this.lastStationIdPaths = { half: '', hour: '' };
    this.lastStationIdSlot = '';
    this.stationIdClockTimer = null;
    this.currentStation = null;
    this.currentRecording = null;
    this.mediaState = "stopped";
    this.music = null;
    this.musicGeneration = 0;
    this.musicRetry = null;
    this.musicCrossfadeTimer = null;
    this.musicPreparationTimer = null;
    this.musicBusy = false;
    this.pendingStation = null;
    this.pendingStationTimer = null;
  }

  getCurrentStation() {
    return publicStation(this.currentStation);
  }

  getMediaState() {
    return this.mediaState;
  }

  getStatus(playerStatus = this.player.getStatus()) {
    return {
      ...playerStatus,
      mediaState: this.mediaState,
      currentStation: this.getCurrentStation(),
      currentRecording: publicRecording(this.currentRecording),
      queuedStation: this.pendingStation ? (this.pendingStation.target.profile?.name || musicContextLabel({ mode: this.pendingStation.target.mode, seed: this.pendingStation.target.track })) : '',
      currentMusic: this.music ? {
        track: this.stationIdPlaying || this.music.current,
        seed: (() => { const seed = { ...this.music.seed }; delete seed.path; return seed; })(),
        mode: this.music.mode,
        mixId: this.music.mixId || '',
        label: musicContextLabel(this.music),
        awayFromSeed: this.musicRadio?.isAwayFromSeed?.() === true,
        waiting: this.music.waiting
      } : null
    };
  }

  getPresets() {
    return this.getStations()
      .filter((station) => station.preset)
      .sort(sortPresets);
  }

  async playUrl(url) {
    const station = this.getStations().find((item) => item.url === url);
    if (!station) throw new Error("That station is no longer in WaveDeck.");
    return this.playStation(station);
  }

  async playStationById(stationId) {
    const id = String(stationId ?? "").trim();
    const station = this.getStations().find((item) => String(item.id) === id);
    if (!station) throw new Error("That station is no longer in WaveDeck.");
    return this.playStation(station);
  }

  async playStation(station) {
    this.clearMusic();
    const nextStation = publicStation(station);
    const stationChanged = this.currentStation && (
      String(this.currentStation.id) !== String(nextStation.id) ||
      this.currentStation.url !== nextStation.url
    );
    if (stationChanged) {
      await this.beforeStationChange({
        previousStation: this.getCurrentStation(),
        nextStation
      });
    }
    this.currentRecording = null;
    this.currentStation = nextStation;
    const stationId = this.currentStation.id;
    this.mediaState = "playing";
    this.onStationChanged(this.getCurrentStation());
    this.onStateChanged(this.getStatus());
    try {
      await this.player.setStationGain(this.currentStation.gainDb);
      await this.player.play(this.currentStation.url);
    } catch (error) {
      if (String(this.currentStation?.id) === stationId) {
        this.mediaState = "stopped";
        this.onStateChanged({
          ...this.getStatus(),
          state: "error",
          playing: false,
          message: `Could not play station: ${error.message}`
        });
      }
      throw error;
    }
    return this.getCurrentStation();
  }

  async playRecording(recording) {
    this.clearMusic();
    const nextRecording = {
      ...publicRecording(recording),
      path: String(recording?.path ?? "")
    };
    if (!nextRecording.id || !nextRecording.path) throw new Error("That recording is no longer available.");

    await this.beforeStop({
      reason: "recording-playback",
      station: this.getCurrentStation(),
      recording: publicRecording(nextRecording)
    });
    this.currentStation = null;
    this.currentRecording = nextRecording;
    const recordingId = nextRecording.id;
    this.mediaState = "playing";
    this.onStationChanged(null);
    this.onStateChanged(this.getStatus());
    try {
      await this.player.setStationGain(0);
      await this.player.play(nextRecording.path);
    } catch (error) {
      if (String(this.currentRecording?.id) === recordingId) {
        this.mediaState = "stopped";
        this.onStateChanged({
          ...this.getStatus(),
          state: "error",
          playing: false,
          message: `Could not play recording: ${error.message}`
        });
      }
      throw error;
    }
    return publicRecording(this.currentRecording);
  }

  async pause() {
    if (this.mediaState !== "playing") return false;
    if (this.music) {
      clearTimeout(this.musicRetry);
      await this.player.setPaused(true);
      this.mediaState = 'paused'; this.onStateChanged(this.getStatus()); return true;
    }
    await this.beforeStop({ reason: "pause", station: this.getCurrentStation() });
    this.mediaState = "paused";
    this.onStateChanged(this.getStatus());
    await this.player.stop();
    return true;
  }

  async stop() {
    if (this.music) this.clearMusic();
    await this.beforeStop({ reason: "stop", station: this.getCurrentStation() });
    this.mediaState = "stopped";
    this.onStateChanged(this.getStatus());
    await this.player.stop();
    return true;
  }

  async setVolume(normalizedValue) {
    const normalized = Math.min(Math.max(Number(normalizedValue) || 0, 0), 1);
    await this.player.setVolume(normalized * 100);
    return normalized;
  }

  async setStationGain(stationId, value) {
    const id = String(stationId ?? "").trim();
    const gainDb = Number(value) || 0;
    if (String(this.currentStation?.id) !== id) return false;
    this.currentStation = { ...this.currentStation, gainDb };
    await this.player.setStationGain(gainDb);
    this.onStateChanged(this.getStatus());
    return true;
  }

  async play() {
    if (this.music) {
      this.mediaState = 'playing';
      if (this.music.waiting) await this.advanceMusic(); else await this.player.setPaused(false);
      this.onStateChanged(this.getStatus()); return true;
    }
    if (this.mediaState === "playing" && this.player.getStatus().playing) return true;
    if (this.currentStation) {
      await this.playStation(this.currentStation);
      return true;
    }
    if (this.currentRecording) {
      await this.playRecording(this.currentRecording);
      return true;
    }

    const presets = this.getPresets();
    if (!presets.length) return false;
    await this.playStation(presets[0]);
    return true;
  }

  async togglePlayPause() {
    if (this.mediaState === "playing") return this.pause();
    return this.play();
  }

  async nextPreset() {
    if (this.music) {
      if (this.stationIdPlaying) { this.stationIdPlaying = null; return this.advanceMusic('next'); }
      if (['radio', 'artist', 'explore', 'mix'].includes(this.music.mode) && this.music.current) {
        void Promise.resolve(this.musicRadio?.recordFeedback(this.music.radioKey, this.music.current, 'skip')).catch(() => {});
      }
      if (this.pendingStation) return this.#startPendingStation(this.pendingStation);
      return this.advanceMusic('skip');
    }
    return this.#movePreset(1);
  }

  async previousPreset() {
    if (this.music) {
      if (this.stationIdPlaying) { this.stationIdPlaying = null; return this.advanceMusic('next'); }
      if (this.pendingStation) { this.pendingStation = null; clearInterval(this.pendingStationTimer); this.pendingStationTimer = null; this.musicRadio?.cancelPending?.(); this.onStateChanged(this.getStatus()); }
      if (this.musicBusy) return false;
      if ((this.player.getStatus().position || 0) > 3) { await this.player.seek(0); return true; }
      if (this.music.back.length > 1) {
        this.music.back.pop();
        const previous = this.music.back.pop();
        if (this.music.mode === 'album') this.music.queue.unshift(this.music.current.id);
        return this.loadMusic(previous);
      }
      await this.player.seek(0); return true;
    }
    return this.#movePreset(-1);
  }

  async #movePreset(direction) {
    const presets = this.getPresets();
    if (!presets.length) return false;

    const currentIndex = presets.findIndex((station) => (
      String(station.id) === String(this.currentStation?.id) ||
      station.url === this.currentStation?.url
    ));
    let targetIndex;
    if (currentIndex < 0) targetIndex = direction > 0 ? 0 : presets.length - 1;
    else targetIndex = (currentIndex + direction + presets.length) % presets.length;

    await this.playStation(presets[targetIndex]);
    return true;
  }

  configureMusic(library, radio, onMusicTrack = () => {}) {
    this.musicLibrary = library; this.musicRadio = radio;
    this.onMusicTrack = typeof onMusicTrack === 'function' ? onMusicTrack : () => {};
  }

  clearMusic() {
    this.stationIdPlaying = null;
    this.stationIdQueued = null;
    clearInterval(this.stationIdClockTimer); this.stationIdClockTimer = null;
    this.pendingStation = null; clearInterval(this.pendingStationTimer); this.pendingStationTimer = null;
    this.musicGeneration++; clearTimeout(this.musicRetry); clearInterval(this.musicCrossfadeTimer); clearTimeout(this.musicPreparationTimer); this.musicCrossfadeTimer = null; this.musicPreparationTimer = null; this.music = null;
    this.musicRadio?.cancelPending?.();
  }

  #currentStationIdSlot() {
    const current = new Date(this.now());
    const minute = current.getMinutes();
    if (minute < 29) return null;
    const stamp = [current.getFullYear(), String(current.getMonth() + 1).padStart(2, '0'), String(current.getDate()).padStart(2, '0'), String(current.getHours()).padStart(2, '0')].join('-');
    if (minute >= 59) return { key: `${stamp}:top`, pool: 'hour', label: 'Top of Hour' };
    return { key: `${stamp}:half`, pool: 'half', label: 'Half Hour' };
  }

  #dueStationId() {
    if (!this.music || this.music.mode === 'song' || this.stationIdPlaying || !this.stationIdsDir) return null;
    if (this.music.mode === 'album' && !this.music.albumArtistSeed && !this.music.queue.length && !this.music.prepared) return null;
    if (this.stationIdQueued) return this.stationIdQueued;
    const slot = this.#currentStationIdSlot();
    if (!slot || slot.key === this.lastStationIdSlot) return null;
    this.lastStationIdSlot = slot.key;
    let clips;
    try {
      clips = fs.readdirSync(this.stationIdDirectories[slot.pool], { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(mp3|opus)$/i.test(entry.name))
        .map(entry => path.join(this.stationIdDirectories[slot.pool], entry.name));
    } catch { clips = []; }
    if (!clips.length) return null;
    const choices = clips.length > 1 ? clips.filter(file => file !== this.lastStationIdPaths[slot.pool]) : clips;
    const file = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))] || clips[0];
    this.stationIdQueued = { file, ...slot };
    return this.stationIdQueued;
  }

  async #playStationId() {
    const queued = this.#dueStationId();
    if (!queued) return false;
    this.stationIdQueued = null;
    const clip = { id: 'station_id', title: 'Station ID', artist: 'WaveDeck', album: '', stationId: true, fileName: path.basename(queued.file), stationIdPool: queued.label };
    this.stationIdPlaying = clip;
    try {
      await this.player.play(queued.file);
      this.lastStationIdPaths[queued.pool] = queued.file;
      try {
        this.onStationIdPlayed({
          type: 'station-id', at: new Date(this.now()).toISOString(),
          stationKey: this.music?.radioKey || '', mode: this.music?.mode || '',
          fileName: clip.fileName, pool: queued.label
        });
      } catch {}
      this.onStateChanged(this.getStatus());
      return true;
    } catch {
      this.stationIdPlaying = null;
      return false;
    }
  }

  #scheduleStationIdClockCheck() {
    clearInterval(this.stationIdClockTimer); this.stationIdClockTimer = null;
    if (!this.music || this.music.mode === 'song') return;
    this.#dueStationId();
    this.stationIdClockTimer = setInterval(() => this.#dueStationId(), 15_000);
    this.stationIdClockTimer.unref?.();
  }

  #queueStationChange(target) {
    if (!this.getFinishCurrentSongOnStationChange() || !this.music?.current || this.stationIdPlaying || this.mediaState !== 'playing') return false;
    const status = this.player.getStatus();
    if (!(Number(status.duration) > 1) || !(Number(status.position) >= 0)) return false;
    clearInterval(this.musicCrossfadeTimer); this.musicCrossfadeTimer = null;
    clearTimeout(this.musicPreparationTimer); this.musicPreparationTimer = null;
    this.music.prepared = null;
    this.musicRadio?.cancelPending?.();
    const pending = { target, ready: null, preparing: null };
    this.pendingStation = pending;
    pending.preparing = this.#prepareStationChange(pending).catch(error => {
      if (this.pendingStation !== pending) return;
      pending.error = error;
      this.pendingStation = null;
      clearInterval(this.pendingStationTimer); this.pendingStationTimer = null;
      this.onStateChanged({ ...this.getStatus(), message: `Could not change stations: ${error.message}` });
      if (this.music?.current) this.#scheduleMusicCrossfade(this.music.current, this.musicGeneration);
    });
    clearInterval(this.pendingStationTimer);
    this.pendingStationTimer = setInterval(() => {
      if (this.pendingStation !== pending || !pending.ready || this.mediaState !== 'playing' || this.player.isCrossfading || this.musicBusy) return;
      const playback = this.player.getStatus();
      const duration = Number(playback.duration) || 0;
      const position = Number(playback.position) || 0;
      const fadeSeconds = Math.min(8, Math.max(1, duration - 0.5));
      if (this.getCrossfadeEnabled() && duration > 1 && position >= duration - fadeSeconds) {
        clearInterval(this.pendingStationTimer); this.pendingStationTimer = null;
        void this.#startPendingStation(pending, fadeSeconds * 1000).catch(error => this.musicError(error));
      }
    }, 250);
    this.pendingStationTimer.unref?.();
    this.onStateChanged(this.getStatus());
    return true;
  }

  async #prepareStationChange(pending) {
    const { target } = pending;
    await this.musicRadio?.beginSession?.();
    if (this.pendingStation !== pending) return;
    let track = target.track;
    let plannedSet = null;
    let decision = null;
    const radioProfile = this.getLocalStationProfile({ mode: target.mode, seed: track });
    if (target.mode === 'artist') await this.musicRadio?.beginArtistSession?.(track);
    if (target.mode === 'explore') await this.musicRadio?.beginExploreSession?.(track);
    if (target.mode === 'radio' || target.mode === 'explore') {
      await this.musicRadio?.setTracks?.(this.musicLibrary.tracks, `${this.musicLibrary.revision}:${this.musicLibrary.metadataRevision || 0}`);
      if (this.pendingStation !== pending) return;
      plannedSet = await this.musicRadio?.planInitialArtistSet?.(this.musicLibrary.tracks, track, target.mode, target.radioKey, radioProfile?.profile) || null;
    }
    if (target.mode === 'mix') {
      await this.musicRadio?.setTracks?.(this.musicLibrary.tracks, `${this.musicLibrary.revision}:${this.musicLibrary.metadataRevision || 0}`);
      if (this.pendingStation !== pending) return;
      const choice = await this.musicRadio.choose(this.musicLibrary.tracks, target.profile, 'mix', new Set(), 'start', target.radioKey, true, null);
      if (this.pendingStation !== pending) return;
      if (!choice?.id) throw new Error('This Local Mix has no playable tracks.');
      decision = this.musicRadio?.getLastDecision?.() || null;
      track = await this.musicLibrary.resolve(choice.id);
    }
    if (this.pendingStation !== pending) return;
    if (track?.doNotPlay) throw new Error('This song is marked Do Not Play.');
    pending.ready = { track, plannedSet, decision, radioProfile };
  }

  async #startPendingStation(pending, crossfadeMs = 0) {
    if (this.pendingStation !== pending || this.musicBusy) return false;
    this.musicBusy = true;
    try {
      await pending.preparing;
      if (this.pendingStation !== pending) return false;
      if (pending.error) {
        this.pendingStation = null;
        this.onStateChanged({ ...this.getStatus(), message: `Could not change stations: ${pending.error.message}` });
        if (crossfadeMs && this.music?.current) this.#scheduleMusicCrossfade(this.music.current, this.musicGeneration);
        return false;
      }
      if (!pending.ready) return false;
      const { target, ready } = pending;
      await this.beforeStop({ reason: 'music-playback', station: this.getCurrentStation() });
      if (this.pendingStation !== pending) return false;
      this.clearMusic();
      this.currentStation = null; this.currentRecording = null;
      this.music = {
        seed: target.mode === 'mix' ? { id: target.radioKey, title: target.profile.name, artist: '', album: '', genres: [] } : target.track,
        profile: target.profile, mixId: target.profile?.id, label: target.profile?.name,
        mode: target.mode, radioKey: target.radioKey, current: null, queue: [], back: [], failed: new Set(),
        waiting: false, prepared: null, preparing: null,
        pendingPreparedDecision: ready.decision ? { id: ready.track.id, track: ready.track, decision: ready.decision } : null,
        initialRadioSelectionPending: ['radio', 'artist', 'explore'].includes(target.mode), initialArtistSet: ready.plannedSet, radioProfile: ready.radioProfile
      };
      this.onLocalStationStart({ key: this.music.radioKey, mode: this.music.mode, seed: this.music.seed, profile: this.music.radioProfile?.profile || null, stationProfile: this.music.radioProfile || null });
      this.onStationChanged(null);
      return await this.loadMusic(ready.track.id, crossfadeMs, ready.track);
    } finally { this.musicBusy = false; }
  }

  async playMusic(id, mode = 'song') {
    if (!['song', 'album', 'artist', 'radio', 'explore'].includes(mode)) throw new Error('Unknown music mode.');
    const track = await this.musicLibrary.resolve(id);
    if (track.doNotPlay) throw new Error('This song is marked Do Not Play.');
    if (['radio', 'artist', 'explore'].includes(mode) && this.#queueStationChange({ mode, track, radioKey: `${mode}:${track.songKey || track.id}` })) return true;
    await this.beforeStop({ reason: 'music-playback', station: this.getCurrentStation() });
    this.clearMusic();
    await this.musicRadio?.beginSession?.();
    this.currentStation = null; this.currentRecording = null;
    const album = this.musicLibrary.tracks.filter(t => !t.doNotPlay && track.album && normalize(t.album) === normalize(track.album) &&
      ((compilation(track) && !track.albumArtist) || normalize(t.albumArtist || t.artist) === normalize(track.albumArtist || track.artist)))
      .sort((a, b) => a.disc - b.disc || a.track - b.track || a.relativePath.localeCompare(b.relativePath));
    if (mode === 'album' && !album.length) album.push(track);
    const albumArtistSeed = mode === 'album' ? artistRadioSeedForAlbum(track) : null;
    const radioProfile = this.getLocalStationProfile({ mode, seed: track });
    this.music = { seed: track, albumArtistSeed, mode, radioKey: `${mode}:${track.songKey || track.id}`, current: null, queue: mode === 'album' ? album.map(t => t.id) : [], back: [], failed: new Set(), waiting: false, prepared: null, preparing: null, pendingPreparedDecision: null, initialRadioSelectionPending: ['radio', 'artist', 'explore'].includes(mode), radioProfile };
    if (mode === 'artist') await this.musicRadio?.beginArtistSession?.(track);
    if (mode === 'explore') await this.musicRadio?.beginExploreSession?.(track);
    if (mode === 'radio' || mode === 'explore') {
      await this.musicRadio?.setTracks?.(this.musicLibrary.tracks, `${this.musicLibrary.revision}:${this.musicLibrary.metadataRevision || 0}`);
      this.music.initialArtistSet = await this.musicRadio?.planInitialArtistSet?.(this.musicLibrary.tracks, track, mode, this.music.radioKey, radioProfile?.profile) || null;
    }
    this.onLocalStationStart({ key: this.music.radioKey, mode: this.music.mode, seed: this.music.seed, profile: this.music.radioProfile?.profile || null, stationProfile: this.music.radioProfile || null });
    this.onStationChanged(null);
    return this.loadMusic(mode === 'album' ? this.music.queue.shift() : id);
  }

  async playLocalMix(mixId) {
    const mix = resolveLocalMix(mixId, this.musicLibrary.tracks, this.dataDir);
    if (this.#queueStationChange({ mode: 'mix', profile: mix, radioKey: `mix:${mix.id}` })) return true;
    await this.beforeStop({ reason: 'music-playback', station: this.getCurrentStation() });
    this.clearMusic();
    await this.musicRadio?.beginSession?.();
    this.currentStation = null; this.currentRecording = null;
    const radioProfile = this.getLocalStationProfile({ mode: 'mix', seed: null });
    this.music = {
      seed: { id: `mix:${mix.id}`, title: mix.name, artist: '', album: '', genres: [] },
      profile: mix, mixId: mix.id, label: mix.name, mode: 'mix', radioKey: `mix:${mix.id}`,
      current: null, queue: [], back: [], failed: new Set(), waiting: false, prepared: null, preparing: null, pendingPreparedDecision: null, radioProfile
    };
    this.onLocalStationStart({ key: this.music.radioKey, mode: this.music.mode, seed: this.music.seed, profile: this.music.radioProfile?.profile || null, stationProfile: this.music.radioProfile || null });
    this.onStationChanged(null);
    return this.advanceMusic('start');
  }

  async loadMusic(id, crossfadeMs = 0, resolvedTrack = null) {
    clearInterval(this.musicCrossfadeTimer); this.musicCrossfadeTimer = null;
    const generation = this.musicGeneration;
    const prepared = this.music?.pendingPreparedDecision?.id === id
      ? this.music.pendingPreparedDecision
      : null;
    const deferredDecision = prepared
      ? this.music.pendingPreparedDecision.decision
      : null;
    if (deferredDecision?.preparation) {
      deferredDecision.preparation.usedBy = 'advance';
      deferredDecision.preparation.usedAt = new Date().toISOString();
    }
    const track = resolvedTrack || prepared?.track || await this.musicLibrary.resolve(id);
    if (track.doNotPlay) throw new Error('This song is marked Do Not Play.');
    if (!this.music || generation !== this.musicGeneration) return false;
    this.music.waiting = false;
    this.mediaState = 'playing';
    await this.player.setStationGain(0);
    if (!this.music || generation !== this.musicGeneration) return false;
    if (crossfadeMs > 0) await this.player.crossfadeTo(track.path, crossfadeMs);
    else await this.player.play(track.path);
    if (!this.music || generation !== this.musicGeneration) return false;
    if (this.music?.pendingPreparedDecision?.id === id) this.music.pendingPreparedDecision = null;
    if (!await this.#commitMusicTrack(track, id, deferredDecision)) return false;
    if (!this.music || generation !== this.musicGeneration) return false;
    this.#scheduleMusicCrossfade(track, generation);
    return true;
  }

  async #commitMusicTrack(track, id, deferredDecision = null, preparationDelay = 1000) {
    const active = this.music;
    const generation = this.musicGeneration;
    this.music.current = { ...track }; delete this.music.current.path;
    this.stationIdPlaying = null;
    this.music.waiting = false;
    this.mediaState = 'playing';
    this.music.back.push(id); this.music.back = this.music.back.slice(-100);
    await this.musicRadio.record(track);
    if (this.music !== active || generation !== this.musicGeneration) return false;
    if (this.music.initialRadioSelectionPending) {
      this.music.initialRadioSelectionPending = false;
      await this.musicRadio.recordManualStart?.(track, this.music.mode, this.music.radioKey, this.music.initialArtistSet, this.music.radioProfile?.profile);
      if (this.music !== active || generation !== this.musicGeneration) return false;
    }
    if (deferredDecision) await this.musicRadio?.publishDecision?.(deferredDecision);
    if (this.music !== active || generation !== this.musicGeneration) return false;
    try { this.onMusicTrack(track); } catch {}
    this.onStateChanged(this.getStatus());
    this.#scheduleStationIdClockCheck();
    this.#scheduleMusicPreparation(this.musicGeneration, preparationDelay);
    return true;
  }

  async #nextMusicId(reason, { usePrepared = true, deferDecision = false } = {}) {
    const active = this.music;
    if (usePrepared && active.preparing) {
      await active.preparing;
      if (this.music !== active) return '';
    }
    if (usePrepared && this.music.prepared?.id) {
      const prepared = this.music.prepared;
      this.music.prepared = null;
      this.music.pendingPreparedDecision = prepared;
      return prepared.id;
    }
    let id = this.music.queue.shift();
    if (!id && this.music.mode === 'album') {
      const artistSeed = this.music.albumArtistSeed;
      if (!artistSeed) {
        this.music.albumFinished = true;
        return '';
      }
      this.music.mode = 'artist';
      this.music.seed = artistSeed;
      this.music.radioKey = `artist:${artistSeed.songKey || artistSeed.id}`;
      this.music.radioProfile = this.getLocalStationProfile({ mode: 'artist', seed: artistSeed });
      await this.musicRadio?.beginArtistSession?.(artistSeed);
      if (this.music !== active) return '';
      this.onLocalStationStart({ key: this.music.radioKey, mode: this.music.mode, seed: this.music.seed, profile: this.music.radioProfile?.profile || null, stationProfile: this.music.radioProfile || null });
    }
    if (!id) {
      await this.musicRadio?.setTracks?.(this.musicLibrary.tracks, `${this.musicLibrary.revision}:${this.musicLibrary.metadataRevision || 0}`);
      if (this.music !== active) return '';
      try {
        id = (await this.musicRadio.choose(this.musicLibrary.tracks, this.music.profile || this.music.seed, this.music.mode, this.music.failed, reason, this.music.radioKey, deferDecision, this.music.radioProfile?.profile))?.id;
      } catch (error) {
        if (this.music !== active || error.message === 'Local Radio selection canceled.') return '';
        throw error;
      }
    }
    return id;
  }

  #scheduleMusicPreparation(generation, delay = 1000) {
    clearTimeout(this.musicPreparationTimer); this.musicPreparationTimer = null;
    if (!this.music || this.music.mode === 'song' || this.music.waiting) return;
    this.musicPreparationTimer = setTimeout(() => {
      this.musicPreparationTimer = null;
      void this.#prepareUpcomingMusic(generation);
    }, delay);
    this.musicPreparationTimer.unref?.();
  }

  async #prepareUpcomingMusic(generation) {
    if (!this.music || generation !== this.musicGeneration || this.music.prepared || this.music.pendingPreparedDecision || this.music.waiting) return false;
    if (this.music.preparing) return this.music.preparing;
    if (this.musicBusy) {
      // A player handoff can still be finishing when the original timer fires.
      // Keep trying briefly rather than silently losing the prepared-next path.
      this.#scheduleMusicPreparation(generation, 250);
      return false;
    }
    const active = this.music;
    const preparation = this.#performMusicPreparation(generation);
    active.preparing = preparation;
    try { return await preparation; }
    finally { if (active.preparing === preparation) active.preparing = null; }
  }

  async #performMusicPreparation(generation) {
    try {
      const preparationStartedAt = Date.now();
      const selectionStartedAt = Date.now();
      const id = await this.#nextMusicId('prepared', { usePrepared: false, deferDecision: true });
      if (!id || !this.music || generation !== this.musicGeneration) return false;
      const selectionMs = Date.now() - selectionStartedAt;
      const resolveStartedAt = Date.now();
      const track = await this.musicLibrary.resolve(id);
      if (track.doNotPlay) throw new Error('This song is marked Do Not Play.');
      if (!this.music || generation !== this.musicGeneration) return false;
      const timing = {
        preparedAt: new Date(preparationStartedAt).toISOString(),
        selectionMs,
        workerSelectionMs: this.musicRadio?.getLastSelectionMs?.() ?? null,
        resolveMs: Date.now() - resolveStartedAt,
        totalMs: Date.now() - preparationStartedAt
      };
      const decision = this.musicRadio?.getLastDecision?.() || null;
      if (decision) decision.preparation = timing;
      this.music.prepared = { id, track, decision, timing };
      return true;
    } catch {
      // A future choice is an optimization only. The normal transition path
      // will retry the selection and surface a real playback error if needed.
      return false;
    }
  }

  #discardPreparedDecision(id) {
    if (this.music?.pendingPreparedDecision?.id === id) this.music.pendingPreparedDecision = null;
  }

  #scheduleMusicCrossfade(track, generation) {
    clearInterval(this.musicCrossfadeTimer); this.musicCrossfadeTimer = null;
    if (!this.getCrossfadeEnabled() || !this.music || this.music.mode === 'song') return;
    const fallbackDuration = Number(track?.duration) || 0;
    if (fallbackDuration <= 1) return;
    this.musicCrossfadeTimer = setInterval(() => {
      if (!this.music || generation !== this.musicGeneration || this.mediaState !== 'playing' || this.player.isCrossfading) return;
      const status = this.player.getStatus();
      const duration = Number(status.duration) || fallbackDuration;
      const position = Number(status.position) || 0;
      const fadeSeconds = Math.min(8, Math.max(1, duration - 0.5));
      if (duration > 1 && position >= duration - fadeSeconds) {
        clearInterval(this.musicCrossfadeTimer); this.musicCrossfadeTimer = null;
        if (this.#dueStationId()) return;
        void this.#beginMusicCrossfade(fadeSeconds * 1000, generation).catch(error => this.musicError(error));
      }
    }, 250);
  }

  async #beginMusicCrossfade(durationMs, generation) {
    if (!this.music || generation !== this.musicGeneration || this.musicBusy) return false;
    this.musicBusy = true;
    let id = '';
    try {
      id = await this.#nextMusicId('crossfade');
      if (!id) return false;
      if (!this.music || generation !== this.musicGeneration) return false;
      const deferredDecision = this.music?.pendingPreparedDecision?.id === id
        ? this.music.pendingPreparedDecision.decision
        : null;
      if (deferredDecision?.preparation) {
        deferredDecision.preparation.usedBy = 'crossfade';
        deferredDecision.preparation.usedAt = new Date().toISOString();
      }
      const preparedTrack = this.music?.pendingPreparedDecision?.id === id
        ? this.music.pendingPreparedDecision.track
        : null;
      const track = preparedTrack || await this.musicLibrary.resolve(id);
      if (track.doNotPlay) throw new Error('This song is marked Do Not Play.');
      if (!this.music || generation !== this.musicGeneration) return false;
      await this.player.crossfadeTo(track.path, durationMs);
      if (!this.music || generation !== this.musicGeneration) return false;
      if (this.music?.pendingPreparedDecision?.id === id) this.music.pendingPreparedDecision = null;
      // Selecting the following fresh artist can be expensive in a large
      // library. Do not run it while the equal-power volume ramp is active:
      // that ramp lives on this same process and a blocked timer would let the
      // incoming song advance silently before it becomes audible.
      if (!await this.#commitMusicTrack(track, id, deferredDecision, Math.max(1000, Math.round(durationMs) + 250))) return false;
      if (!this.music || generation !== this.musicGeneration) return false;
      this.#scheduleMusicCrossfade(track, generation);
      return true;
    } catch (error) {
      this.#discardPreparedDecision(id);
      if (this.music && generation === this.musicGeneration && id) this.music.failed.add(id);
      return false;
    } finally { this.musicBusy = false; }
  }

  async advanceMusic(reason = 'next') {
    if (!this.music || this.musicBusy) return false;
    this.musicBusy = true;
    const generation = this.musicGeneration;
    clearTimeout(this.musicRetry);
    try {
      if (reason === 'error' && this.music.current) this.music.failed.add(this.music.current.id);
      if (this.music.mode === 'song') { await this.stop(); return true; }
      while (this.music && generation === this.musicGeneration) {
        const id = await this.#nextMusicId(reason);
        if (!this.music || generation !== this.musicGeneration) return false;
        if (!id) {
          if (this.music?.albumFinished) {
            await this.stop();
            return true;
          }
          this.music.waiting = true;
          await this.player.stop();
          this.onStateChanged({ ...this.getStatus(), message: 'Waiting for a song that fits this radio seed and is eligible to play.' });
          this.musicRetry = setTimeout(() => {
            if (this.music && this.mediaState === 'playing') void this.advanceMusic().catch(error => this.musicError(error));
          }, 15000);
          return false;
        }
        try { return await this.loadMusic(id); }
        catch (error) { this.#discardPreparedDecision(id); if (!this.music || generation !== this.musicGeneration) return false; this.music.failed.add(id); }
      }
    } finally { this.musicBusy = false; }
    return false;
  }

  musicError(error) {
    if (!this.music) return;
    clearTimeout(this.musicRetry); this.mediaState = 'paused';
    this.onStateChanged({ ...this.getStatus(), state: 'error', message: error.message });
  }

  async handleEnded(event) {
    if (!this.music || this.mediaState !== 'playing') return;
    try {
      if (this.stationIdPlaying) {
        this.stationIdPlaying = null;
        return await this.advanceMusic('next');
      }
      if (this.pendingStation) {
        const pending = this.pendingStation;
        await pending.preparing;
        if (this.pendingStation === pending && pending.ready) {
          if (await this.#startPendingStation(pending)) return;
        }
        if (this.pendingStation === pending && pending.error) await this.#startPendingStation(pending);
      }
      if (event?.reason === 'eof' && ['radio', 'artist', 'explore', 'mix'].includes(this.music.mode) && this.music.current) {
        void Promise.resolve(this.musicRadio?.recordFeedback(this.music.radioKey, this.music.current, 'complete')).catch(() => {});
      }
      if (event?.reason === 'eof' && await this.#playStationId()) return;
      await this.advanceMusic(event.reason);
    } catch (error) { this.musicError(error); }
  }

  async rateMusic(kind) {
    if (!this.music || this.stationIdPlaying || !['radio', 'artist', 'explore', 'mix'].includes(this.music.mode) || !this.music.current) {
      throw new Error('Start Local Radio before using feedback.');
    }
    const valid = kind === 'up' || kind === 'down';
    if (!valid) throw new Error('Unknown Local Radio feedback.');
    void Promise.resolve(this.musicRadio?.recordFeedback(this.music.radioKey, this.music.current, kind)).catch(() => {});
    return true;
  }
}

// Serialize external transport commands (including EOF) across IPC and media keys.
// Internal calls bind to the original controller, so nested play/stop calls do not deadlock.
function serializeTransport(controller) {
  let pending = Promise.resolve();
  const mutations = new Set(['playStationById', 'playStation', 'playUrl', 'playRecording', 'playMusic', 'playLocalMix',
    'pause', 'stop', 'play', 'togglePlayPause', 'nextPreset', 'previousPreset', 'handleEnded', 'rateMusic']);
  return new Proxy(controller, { get(target, key) {
    const value = target[key];
    if (typeof value !== 'function') return value;
    if (!mutations.has(key)) return value.bind(target);
    return (...args) => {
      const result = pending.then(() => value.apply(target, args));
      pending = result.catch(() => {}); return result;
    };
  } });
}
module.exports = { MediaController, serializeTransport, publicRecording, publicStation, sortByName, sortPresets };
