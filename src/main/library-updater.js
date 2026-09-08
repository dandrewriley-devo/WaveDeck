const https = require("https");

const LIBRARY_UPDATE_URL = "https://fabulon.cloud/downloads/library_update.json";
const LIBRARY_UPDATE_TIMEOUT_MS = 8_000;
const MAX_LIBRARY_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_LIBRARY_REDIRECTS = 5;

function cacheBustedUrl(url, now = Date.now) {
  const target = new URL(url);
  target.searchParams.set("wavedeck", String(now()));
  return target.toString();
}

function nodeHttpsFetch(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_LIBRARY_REDIRECTS) {
      reject(new Error("The library download redirected too many times."));
      return;
    }

    const signal = options.signal;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", abort);
      callback(value);
    };
    const request = https.get(url, { headers: options.headers }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        finish(resolve, nodeHttpsFetch(new URL(location, url).toString(), options, redirectCount + 1));
        return;
      }

      const chunks = [];
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_LIBRARY_DOWNLOAD_BYTES) {
          request.destroy(new Error("The downloaded library is too large."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        finish(resolve, {
          ok: status >= 200 && status < 300,
          status,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] ?? null },
          text: async () => body
        });
      });
      response.on("error", (error) => finish(reject, error));
    });
    const abort = () => request.destroy(new Error("The library download timed out."));
    request.on("error", (error) => finish(reject, error));
    if (signal?.aborted) abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
  });
}

async function fetchLibraryJson({ fetchImpl, url, timeoutMs }) {
  if (typeof fetchImpl !== "function") throw new Error("No library download service is available.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(url, {
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

async function downloadLibrary({
  fetchImpl,
  fallbackFetchImpl,
  url = LIBRARY_UPDATE_URL,
  now = Date.now,
  timeoutMs = LIBRARY_UPDATE_TIMEOUT_MS
}) {
  const targetUrl = cacheBustedUrl(url, now);
  try {
    return await fetchLibraryJson({ fetchImpl, url: targetUrl, timeoutMs });
  } catch (error) {
    if (typeof fallbackFetchImpl !== "function") throw error;
    return fetchLibraryJson({ fetchImpl: fallbackFetchImpl, url: targetUrl, timeoutMs });
  }
}

function createLibraryUpdater({ storage, fetchImpl, fallbackFetchImpl, isPaused = () => false, onApplied = () => {} }) {
  let inFlight = null;

  async function run() {
    if (!storage.getLibraryUpdateState().enabled) return { ok: true, skipped: "disabled" };
    if (isPaused()) return { ok: true, skipped: "paused" };
    try {
      const library = await downloadLibrary({ fetchImpl, fallbackFetchImpl });
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
  downloadLibrary,
  nodeHttpsFetch
};
