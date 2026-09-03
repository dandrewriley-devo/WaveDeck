function sortByName(a, b) {
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""), undefined, {
    sensitivity: "base"
  });
}

function favoriteRank(station) {
  const raw = station?.favoriteOrder;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sortFavorites(a, b) {
  const aRank = favoriteRank(a);
  const bRank = favoriteRank(b);
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
    noPreRoll: Boolean(station.noPreRoll)
  };
}

class MediaController {
  constructor({ player, getStations, onStationChanged, onStateChanged }) {
    this.player = player;
    this.getStations = getStations;
    this.onStationChanged = onStationChanged || (() => {});
    this.onStateChanged = onStateChanged || (() => {});
    this.currentStation = null;
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
      currentStation: this.getCurrentStation()
    };
  }

  getFavorites() {
    return this.getStations()
      .filter((station) => station.favorite)
      .sort(sortFavorites);
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
    this.currentStation = publicStation(station);
    const stationId = this.currentStation.id;
    this.mediaState = "playing";
    this.onStationChanged(this.getCurrentStation());
    this.onStateChanged(this.getStatus());
    try {
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

  async pause() {
    if (this.mediaState !== "playing") return false;
    this.mediaState = "paused";
    this.onStateChanged(this.getStatus());
    await this.player.stop();
    return true;
  }

  async stop() {
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

  async play() {
    if (this.mediaState === "playing" && this.player.getStatus().playing) return true;
    if (this.currentStation) {
      await this.playStation(this.currentStation);
      return true;
    }

    const favorites = this.getFavorites();
    if (!favorites.length) return false;
    await this.playStation(favorites[0]);
    return true;
  }

  async togglePlayPause() {
    if (this.mediaState === "playing") return this.pause();
    return this.play();
  }

  async nextFavorite() {
    return this.#moveFavorite(1);
  }

  async previousFavorite() {
    return this.#moveFavorite(-1);
  }

  async #moveFavorite(direction) {
    const favorites = this.getFavorites();
    if (!favorites.length) return false;

    const currentIndex = favorites.findIndex((station) => (
      String(station.id) === String(this.currentStation?.id) ||
      station.url === this.currentStation?.url
    ));
    let targetIndex;
    if (currentIndex < 0) targetIndex = direction > 0 ? 0 : favorites.length - 1;
    else targetIndex = (currentIndex + direction + favorites.length) % favorites.length;

    await this.playStation(favorites[targetIndex]);
    return true;
  }
}

module.exports = { MediaController, publicStation, sortByName, sortFavorites };
