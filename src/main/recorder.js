const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const RECORDING_BITRATE = "192k";
const GRACEFUL_STOP_TIMEOUT_MS = 10_000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function recordingTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    "-",
    pad(date.getMinutes()),
    "-",
    pad(date.getSeconds())
  ].join("");
}

function safeFilename(value) {
  const cleaned = String(value ?? "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s+-\s*){2,}/g, " - ")
    .replace(/[. -]+$/g, "")
    .trim();
  return (cleaned || "WaveDeck Recording").slice(0, 120).replace(/[. -]+$/g, "");
}

function uniquePath(filePath, fileSystem = fs) {
  if (!fileSystem.existsSync(filePath)) return filePath;
  const extension = path.extname(filePath);
  const base = filePath.slice(0, -extension.length);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!fileSystem.existsSync(candidate)) return candidate;
  }
  throw new Error("WaveDeck could not create a unique recording filename.");
}

function resolveFfmpegExecutable({ packaged = false } = {}) {
  if (process.env.WAVEDECK_FFMPEG_PATH) return process.env.WAVEDECK_FFMPEG_PATH;
  return packaged
    ? path.join(process.resourcesPath, "recording", "ffmpeg")
    : path.join(__dirname, "..", "..", ".cache", "wavedeck-tools", "linux", "ffmpeg");
}

function prepareFfmpegExecutable({
  executable,
  runtimeDir,
  packaged = false,
  platform = process.platform,
  fileSystem = fs
}) {
  if (!packaged || platform !== "linux") return executable;

  const sourceStat = fileSystem.statSync(executable);
  const toolsDir = path.join(runtimeDir, "tools");
  const runtimeExecutable = path.join(toolsDir, `ffmpeg-${sourceStat.size}`);
  fileSystem.mkdirSync(toolsDir, { recursive: true });

  let copyRequired = true;
  try {
    const destinationStat = fileSystem.statSync(runtimeExecutable);
    copyRequired = !destinationStat.isFile() || destinationStat.size !== sourceStat.size;
  } catch {}

  if (copyRequired) {
    const temporaryExecutable = `${runtimeExecutable}.copying-${process.pid}`;
    try {
      fileSystem.copyFileSync(executable, temporaryExecutable);
      fileSystem.chmodSync(temporaryExecutable, 0o755);
      fileSystem.renameSync(temporaryExecutable, runtimeExecutable);
    } catch (error) {
      try { fileSystem.unlinkSync(temporaryExecutable); } catch {}
      throw error;
    }
  }
  fileSystem.chmodSync(runtimeExecutable, 0o755);
  return runtimeExecutable;
}

function verifyFfmpegExecutable({
  executable,
  runtimeDir,
  spawnSyncImpl = spawnSync,
  fileSystem = fs
}) {
  const probePath = path.join(runtimeDir, "tools", `ffmpeg-self-test-${process.pid}.mp3`);
  fileSystem.mkdirSync(path.dirname(probePath), { recursive: true });
  try {
    const result = spawnSyncImpl(executable, [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      "-f", "lavfi",
      "-i", "anullsrc=r=8000:cl=mono",
      "-t", "0.05",
      "-c:a", "libmp3lame",
      "-f", "mp3",
      "-y",
      probePath
    ], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true
    });
    let validOutput = false;
    try {
      const stat = fileSystem.statSync(probePath);
      validOutput = stat.isFile() && stat.size > 0;
    } catch {}
    if (result.error || result.status !== 0 || result.signal || !validOutput) {
      const stderr = String(result.stderr || "").trim().split("\n").filter(Boolean).pop();
      const detail = stderr
        || result.error?.message
        || (result.signal ? `stopped by ${result.signal}` : `exit code ${result.status ?? "unknown"}`);
      throw new Error(`Bundled recording engine failed its startup test: ${detail}`);
    }
    return true;
  } finally {
    try { fileSystem.unlinkSync(probePath); } catch {}
  }
}

function recoverPartialRecordings(recordingsDir, fileSystem = fs) {
  if (!fileSystem.existsSync(recordingsDir)) return [];
  const recovered = [];
  for (const name of fileSystem.readdirSync(recordingsDir)) {
    if (!name.endsWith(".mp3.part")) continue;
    const source = path.join(recordingsDir, name);
    let stat;
    try { stat = fileSystem.statSync(source); } catch { continue; }
    if (!stat.isFile() || stat.size === 0) continue;
    const destination = uniquePath(
      path.join(recordingsDir, `${name.slice(0, -".mp3.part".length)} - incomplete.mp3`),
      fileSystem
    );
    try {
      fileSystem.renameSync(source, destination);
      recovered.push(destination);
    } catch {}
  }
  return recovered;
}

class StreamRecorder {
  constructor({
    executable,
    recordingsDir,
    platform = process.platform,
    spawnImpl = spawn,
    fileSystem = fs,
    now = () => new Date(),
    onStateChanged = () => {}
  }) {
    this.executable = executable;
    this.recordingsDir = recordingsDir;
    this.platform = platform;
    this.spawnImpl = spawnImpl;
    this.fs = fileSystem;
    this.now = now;
    this.onStateChanged = onStateChanged;
    this.process = null;
    this.stopPromise = null;
    this.stopResolve = null;
    this.stopTimer = null;
    this.stderr = "";
    this.session = null;
    this.lastFileName = "";
    this.lastError = "";
  }

  initialize() {
    this.fs.mkdirSync(this.recordingsDir, { recursive: true });
    recoverPartialRecordings(this.recordingsDir, this.fs);
    return this.getState();
  }

  isAvailable() {
    return this.platform === "linux" && Boolean(this.executable);
  }

  isRecording() {
    return Boolean(this.session);
  }

  getState() {
    const startedAt = this.session?.startedAt || null;
    return {
      available: this.isAvailable(),
      active: Boolean(this.session && !this.stopPromise),
      finalizing: Boolean(this.session && this.stopPromise),
      stationId: this.session?.stationId || "",
      stationName: this.session?.stationName || "",
      startedAt: startedAt ? startedAt.toISOString() : "",
      elapsedSeconds: startedAt
        ? Math.max(0, Math.floor((this.now().getTime() - startedAt.getTime()) / 1000))
        : 0,
      fileName: this.session ? path.basename(this.session.finalPath) : "",
      lastFileName: this.lastFileName,
      error: this.lastError
    };
  }

  #emitState() {
    const state = this.getState();
    this.onStateChanged(state);
    return state;
  }

  async start(station) {
    if (!this.isAvailable()) throw new Error("Stream recording is available in the Linux edition.");
    if (this.session) throw new Error("WaveDeck is already recording a station.");
    const stationName = String(station?.name ?? "").trim();
    const streamUrl = String(station?.url ?? "").trim();
    if (!stationName || !streamUrl) throw new Error("Start a station before recording.");

    this.fs.mkdirSync(this.recordingsDir, { recursive: true });
    const startedAt = this.now();
    const safeStationName = safeFilename(stationName).slice(0, 80).replace(/[. -]+$/g, "") || "WaveDeck Recording";
    const baseName = `${safeStationName} - ${recordingTimestamp(startedAt)}`;
    const finalPath = uniquePath(path.join(this.recordingsDir, `${baseName}.mp3`), this.fs);
    const temporaryPath = `${finalPath}.part`;
    const args = [
      "-hide_banner",
      "-loglevel", "warning",
      "-nostdin",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "2",
      "-i", streamUrl,
      "-map", "0:a:0",
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", RECORDING_BITRATE,
      "-metadata", `title=${stationName}`,
      "-metadata", `artist=${stationName}`,
      "-metadata", "album=WaveDeck Recordings",
      "-metadata", `date=${startedAt.getFullYear()}`,
      "-f", "mp3",
      "-y",
      temporaryPath
    ];

    this.stderr = "";
    this.lastError = "";
    this.session = {
      stationId: String(station.id ?? ""),
      stationName,
      startedAt,
      finalPath,
      temporaryPath
    };

    let child;
    try {
      child = this.spawnImpl(this.executable, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
      });
      this.process = child;
    } catch (error) {
      this.session = null;
      this.lastError = `Recording could not start: ${error.message}`;
      this.#emitState();
      throw new Error(this.lastError);
    }

    child.stderr?.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4096);
    });
    child.once("error", (error) => {
      this.lastError = `Recording failed: ${error.message}`;
      this.#finish(-1, null);
    });
    child.once("exit", (code, signal) => this.#finish(code, signal));
    this.#emitState();
    return this.getState();
  }

  stop() {
    if (!this.session) return Promise.resolve(this.getState());
    if (this.stopPromise) return this.stopPromise;

    this.stopPromise = new Promise((resolve) => { this.stopResolve = resolve; });
    this.#emitState();
    try { this.process?.kill("SIGINT"); } catch {}
    this.stopTimer = setTimeout(() => {
      try { this.process?.kill("SIGTERM"); } catch {}
    }, GRACEFUL_STOP_TIMEOUT_MS);
    this.stopTimer.unref?.();
    return this.stopPromise;
  }

  async close() {
    return this.stop();
  }

  #finish(code, signal = null) {
    if (!this.session) return;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    const session = this.session;
    const resolve = this.stopResolve;
    this.process = null;
    this.session = null;
    this.stopPromise = null;
    this.stopResolve = null;

    let saved = false;
    try {
      const stat = this.fs.statSync(session.temporaryPath);
      if (stat.isFile() && stat.size > 0) {
        this.fs.renameSync(session.temporaryPath, session.finalPath);
        this.lastFileName = path.basename(session.finalPath);
        saved = true;
      }
    } catch {}

    if (!saved && code !== 0 && !this.lastError) {
      const detail = this.stderr.trim().split("\n").filter(Boolean).pop();
      this.lastError = detail
        ? `Recording stopped unexpectedly: ${detail}`
        : signal
          ? `Recording engine stopped unexpectedly (${signal}).`
          : `Recording engine stopped unexpectedly (exit code ${code ?? "unknown"}).`;
    } else if (saved) {
      this.lastError = "";
    }

    const state = this.#emitState();
    resolve?.(state);
  }
}

module.exports = {
  GRACEFUL_STOP_TIMEOUT_MS,
  RECORDING_BITRATE,
  StreamRecorder,
  recordingTimestamp,
  prepareFfmpegExecutable,
  recoverPartialRecordings,
  resolveFfmpegExecutable,
  safeFilename,
  uniquePath,
  verifyFfmpegExecutable
};
