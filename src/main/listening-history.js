const MINIMUM_SESSION_MS = 30_000;
const FLUSH_INTERVAL_MS = 30_000;

function cleanListeningHistory(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.stations
    : null;
  const stations = {};

  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [rawId, rawEntry] of Object.entries(source)) {
      const id = String(rawId ?? "").trim();
      if (!id || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const seconds = Math.max(0, Math.floor(Number(rawEntry.seconds) || 0));
      const lastListenedAt = typeof rawEntry.lastListenedAt === "string"
        ? rawEntry.lastListenedAt
        : "";
      if (seconds > 0) stations[id] = { seconds, lastListenedAt };
    }
  }

  const recentStationIds = [...new Set((Array.isArray(value?.recentStationIds) ? value.recentStationIds : [])
    .map(id => String(id ?? "").trim()).filter(Boolean))].slice(0, 10);
  const seenLocalStations = new Set();
  const recentLocalStations = [];
  for (const rawStation of Array.isArray(value?.recentLocalStations) ? value.recentLocalStations : []) {
    if (!rawStation || typeof rawStation !== 'object' || Array.isArray(rawStation)) continue;
    const mode = rawStation.mode === 'artist' ? 'artist' : rawStation.mode === 'radio' ? 'radio' : '';
    const seedId = String(rawStation.seedId ?? '').trim();
    const key = `${mode}:${seedId}`;
    if (!mode || !seedId || seenLocalStations.has(key)) continue;
    seenLocalStations.add(key);
    recentLocalStations.push({
      key, mode, seedId,
      label: String(rawStation.label ?? '').trim().slice(0, 300),
      title: String(rawStation.title ?? '').trim().slice(0, 300),
      artist: String(rawStation.artist ?? '').trim().slice(0, 300),
      album: String(rawStation.album ?? '').trim().slice(0, 300),
      lastPlayedAt: typeof rawStation.lastPlayedAt === 'string' ? rawStation.lastPlayedAt : ''
    });
    if (recentLocalStations.length >= 10) break;
  }
  return { version: 2, stations, recentStationIds, recentLocalStations };
}

class ListeningHistory {
  constructor({
    storage,
    onChanged = () => {},
    now = () => Date.now(),
    minimumSessionMs = MINIMUM_SESSION_MS,
    flushIntervalMs = FLUSH_INTERVAL_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  }) {
    this.storage = storage;
    this.onChanged = onChanged;
    this.now = now;
    this.minimumSessionMs = minimumSessionMs;
    this.flushIntervalMs = flushIntervalMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.history = cleanListeningHistory(storage.readListeningHistory());
    this.session = null;
    this.localStationKey = '';
    this.timer = null;
  }

  getStats() {
    this.#flushEligibleSession();
    return cleanListeningHistory(this.history);
  }

  handleStatus(status) {
    const localStation = this.#localStation(status);
    if (localStation) {
      this.#finishSession();
      if (this.localStationKey === localStation.key) return;
      this.localStationKey = localStation.key;
      this.history.recentLocalStations = [localStation,
        ...this.history.recentLocalStations.filter(station => station.key !== localStation.key)].slice(0, 10);
      this.storage.writeListeningHistory(this.history);
      this.onChanged(cleanListeningHistory(this.history));
      return;
    }
    this.localStationKey = '';
    const stationId = String(status?.currentStation?.id ?? "").trim();
    const shouldTrack = Boolean(
      stationId &&
      status?.mediaState === "playing" &&
      status?.state !== "error"
    );

    if (!shouldTrack) {
      this.#finishSession();
      return;
    }

    if (this.session?.stationId === stationId) return;
    this.#finishSession();
    this.history.recentStationIds = [stationId,
      ...this.history.recentStationIds.filter(id => id !== stationId)].slice(0, 10);
    this.storage.writeListeningHistory(this.history);
    this.onChanged(cleanListeningHistory(this.history));
    this.session = {
      stationId,
      startedAt: this.now(),
      lastRecordedAt: null
    };
    this.#schedule(this.minimumSessionMs);
  }

  reset() {
    const activeStationId = this.session?.stationId || "";
    this.#cancelTimer();
    const cleaned = cleanListeningHistory(this.history);
    this.history = { version: 2, stations: {}, recentStationIds: cleaned.recentStationIds, recentLocalStations: cleaned.recentLocalStations };
    this.storage.writeListeningHistory(this.history);
    this.session = activeStationId ? {
      stationId: activeStationId,
      startedAt: this.now(),
      lastRecordedAt: null
    } : null;
    if (this.session) this.#schedule(this.minimumSessionMs);
    this.onChanged(this.getStats());
    return this.getStats();
  }

  close() {
    this.#finishSession();
    this.#cancelTimer();
  }

  #schedule(delay) {
    this.#cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (!this.session) return;
      this.#flushEligibleSession();
      if (this.session) this.#schedule(this.flushIntervalMs);
    }, Math.max(1, delay));
  }

  #cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  #finishSession() {
    if (!this.session) return;
    this.#flushEligibleSession();
    this.#cancelTimer();
    this.session = null;
  }

  #flushEligibleSession() {
    if (!this.session) return false;
    const currentTime = this.now();
    if (currentTime - this.session.startedAt < this.minimumSessionMs) return false;

    const from = this.session.lastRecordedAt ?? this.session.startedAt;
    const elapsedSeconds = Math.floor((currentTime - from) / 1000);
    if (elapsedSeconds <= 0) return false;

    const existing = this.history.stations[this.session.stationId] || {
      seconds: 0,
      lastListenedAt: ""
    };
    this.history.stations[this.session.stationId] = {
      seconds: existing.seconds + elapsedSeconds,
      lastListenedAt: new Date(currentTime).toISOString()
    };
    this.session.lastRecordedAt = from + (elapsedSeconds * 1000);
    this.storage.writeListeningHistory(this.history);
    this.onChanged(cleanListeningHistory(this.history));
    return true;
  }

  #localStation(status) {
    const music = status?.currentMusic;
    const mode = music?.mode === 'artist' ? 'artist' : music?.mode === 'radio' ? 'radio' : '';
    const seed = music?.seed;
    const seedId = String(seed?.id ?? '').trim();
    if (!mode || !seedId || status?.mediaState !== 'playing' || status?.state === 'error') return null;
    return {
      key: `${mode}:${seedId}`,
      mode,
      seedId,
      label: String(music.label ?? '').trim(),
      title: String(seed.title ?? '').trim(),
      artist: String(seed.artist ?? '').trim(),
      album: String(seed.album ?? '').trim(),
      lastPlayedAt: new Date(this.now()).toISOString()
    };
  }
}

module.exports = {
  FLUSH_INTERVAL_MS,
  ListeningHistory,
  MINIMUM_SESSION_MS,
  cleanListeningHistory
};
