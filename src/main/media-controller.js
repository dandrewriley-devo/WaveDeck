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
    size: Number(recording.size) || 0
  };
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
      currentRecording: publicRecording(this.currentRecording)
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
    await this.beforeStop({ reason: "pause", station: this.getCurrentStation() });
    this.mediaState = "paused";
    this.onStateChanged(this.getStatus());
    await this.player.stop();
    return true;
  }

  async stop() {
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
    return this.#movePreset(1);
  }

  async previousPreset() {
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
}

module.exports = { MediaController, publicRecording, publicStation, sortByName, sortPresets };
