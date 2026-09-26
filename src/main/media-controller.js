const { normalize, compilation, radioArtist } = require('./music-tags');
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
  const seed = music?.seed || music?.current || {};
  if (music?.mode === 'album') return seed.album ? `${seed.album} Radio` : 'Album Radio';
  if (music?.mode === 'artist') return `${radioArtist(seed) || seed.artist || 'Artist'} Radio`;
  if (music?.mode === 'radio') return seed.title ? `${seed.title} Radio` : 'Song Radio';
  return seed.title || 'Song';
}

class MediaController {
  constructor({
    player,
    getStations,
    onStationChanged,
    onStateChanged,
    beforeStationChange,
    beforeStop
  }) {
    this.player = player;
    this.getStations = getStations;
    this.onStationChanged = onStationChanged || (() => {});
    this.onStateChanged = onStateChanged || (() => {});
    this.beforeStationChange = beforeStationChange || (async () => {});
    this.beforeStop = beforeStop || (async () => {});
    this.currentStation = null;
    this.currentRecording = null;
    this.mediaState = "stopped";
    this.music = null;
    this.musicGeneration = 0;
    this.musicRetry = null;
    this.musicBusy = false;
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
      currentMusic: this.music ? {
        track: this.music.current,
        seed: (() => { const seed = { ...this.music.seed }; delete seed.path; return seed; })(),
        mode: this.music.mode,
        label: musicContextLabel(this.music),
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
    if (this.music) return this.advanceMusic();
    return this.#movePreset(1);
  }

  async previousPreset() {
    if (this.music) {
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
    this.musicGeneration++; clearTimeout(this.musicRetry); this.music = null;
  }

  async playMusic(id, mode = 'song') {
    if (!['song', 'album', 'artist', 'radio'].includes(mode)) throw new Error('Unknown music mode.');
    const track = await this.musicLibrary.resolve(id);
    await this.beforeStop({ reason: 'music-playback', station: this.getCurrentStation() });
    this.clearMusic();
    this.currentStation = null; this.currentRecording = null;
    const album = this.musicLibrary.tracks.filter(t => track.album && normalize(t.album) === normalize(track.album) &&
      ((compilation(track) && !track.albumArtist) || normalize(t.albumArtist || t.artist) === normalize(track.albumArtist || track.artist)))
      .sort((a, b) => a.disc - b.disc || a.track - b.track || a.relativePath.localeCompare(b.relativePath));
    if (mode === 'album' && !album.length) album.push(track);
    this.music = { seed: track, mode, current: null, queue: mode === 'album' ? album.map(t => t.id) : [], back: [], failed: new Set(), waiting: false };
    this.onStationChanged(null);
    return this.loadMusic(mode === 'album' ? this.music.queue.shift() : id);
  }

  async loadMusic(id) {
    const generation = this.musicGeneration;
    const track = await this.musicLibrary.resolve(id);
    if (!this.music || generation !== this.musicGeneration) return false;
    this.music.current = { ...track }; delete this.music.current.path;
    this.music.waiting = false;
    this.mediaState = 'playing';
    await this.player.setStationGain(0);
    if (!this.music || generation !== this.musicGeneration) return false;
    await this.player.play(track.path);
    if (!this.music || generation !== this.musicGeneration) return false;
    this.music.back.push(id); this.music.back = this.music.back.slice(-100);
    this.musicRadio.record(track);
    try { this.onMusicTrack(track); } catch {}
    this.onStateChanged(this.getStatus());
    return true;
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
        let id = this.music.queue.shift();
        if (!id && this.music.mode === 'album') this.music.mode = 'artist';
        if (!id) id = this.musicRadio.choose(this.musicLibrary.tracks, this.music.seed, this.music.mode, this.music.failed, reason)?.id;
        if (!id) {
          this.music.waiting = true;
          await this.player.stop();
          this.onStateChanged({ ...this.getStatus(), message: 'Waiting for a song that fits this radio seed and is eligible to play.' });
          this.musicRetry = setTimeout(() => {
            if (this.music && this.mediaState === 'playing') void this.advanceMusic().catch(error => this.musicError(error));
          }, 15000);
          return false;
        }
        try { return await this.loadMusic(id); }
        catch (error) { if (!this.music || generation !== this.musicGeneration) return false; this.music.failed.add(id); }
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
    try { await this.advanceMusic(event.reason); } catch (error) { this.musicError(error); }
  }
}

// Serialize external transport commands (including EOF) across IPC and media keys.
// Internal calls bind to the original controller, so nested play/stop calls do not deadlock.
function serializeTransport(controller) {
  let pending = Promise.resolve();
  const mutations = new Set(['playStationById', 'playStation', 'playUrl', 'playRecording', 'playMusic',
    'pause', 'stop', 'play', 'togglePlayPause', 'nextPreset', 'previousPreset', 'handleEnded']);
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
