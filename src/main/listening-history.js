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

  return { version: 1, stations };
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
    this.timer = null;
  }

  getStats() {
    this.#flushEligibleSession();
    return cleanListeningHistory(this.history);
  }

  handleStatus(status) {
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
    this.history = { version: 1, stations: {} };
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
}

module.exports = {
  FLUSH_INTERVAL_MS,
  ListeningHistory,
  MINIMUM_SESSION_MS,
  cleanListeningHistory
};
