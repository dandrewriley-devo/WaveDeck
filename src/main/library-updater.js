const LIBRARY_UPDATE_URL = "https://fabulon.cloud/downloads/library_update.json";
const LIBRARY_UPDATE_TIMEOUT_MS = 8_000;
const MAX_LIBRARY_DOWNLOAD_BYTES = 5 * 1024 * 1024;

function cacheBustedUrl(url, now = Date.now) {
  const target = new URL(url);
  target.searchParams.set("wavedeck", String(now()));
  return target.toString();
}

async function downloadLibrary({
  fetchImpl,
  url = LIBRARY_UPDATE_URL,
  now = Date.now,
  timeoutMs = LIBRARY_UPDATE_TIMEOUT_MS
}) {
  if (typeof fetchImpl !== "function") throw new Error("No library download service is available.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(cacheBustedUrl(url, now), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "cache-control": "no-cache"
      },
      signal: controller.signal
    });
    if (!response?.ok) throw new Error(`Library download returned HTTP ${response?.status || "error"}.`);
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_LIBRARY_DOWNLOAD_BYTES) {
      throw new Error("The downloaded library is too large.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_LIBRARY_DOWNLOAD_BYTES) {
      throw new Error("The downloaded library is too large.");
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function createLibraryUpdater({ storage, fetchImpl, isPaused = () => false, onApplied = () => {} }) {
  let inFlight = null;

  async function run() {
    if (!storage.getLibraryUpdateState().enabled) return { ok: true, skipped: "disabled" };
    if (isPaused()) return { ok: true, skipped: "paused" };
    try {
      const library = await downloadLibrary({ fetchImpl });
      if (!storage.getLibraryUpdateState().enabled) return { ok: true, skipped: "disabled" };
      if (isPaused()) return { ok: true, skipped: "paused" };
      const result = storage.applyLibraryUpdate(library);
      if (result.applied) onApplied(result);
      return { ok: true, ...result };
    } catch {
      return { ok: false, silent: true };
    }
  }

  return {
    check() {
      if (!inFlight) {
        inFlight = run().finally(() => { inFlight = null; });
      }
      return inFlight;
    }
  };
}

module.exports = {
  LIBRARY_UPDATE_TIMEOUT_MS,
  LIBRARY_UPDATE_URL,
  MAX_LIBRARY_DOWNLOAD_BYTES,
  cacheBustedUrl,
  createLibraryUpdater,
  downloadLibrary
};
