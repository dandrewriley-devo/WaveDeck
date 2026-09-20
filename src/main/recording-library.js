const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function safeRecordingId(value) {
  const name = path.basename(String(value ?? ""));
  return name && name === String(value ?? "") && name.toLowerCase().endsWith(".mp3") ? name : "";
}

function displayName(fileName) {
  return String(fileName ?? "")
    .replace(/\.mp3$/i, "")
    .replace(/\s+-\s+\d{4}-\d{2}-\d{2}\s+\d{2}-\d{2}-\d{2}(?:\s+\(\d+\))?$/u, "")
    .trim() || "WaveDeck Recording";
}

class RecordingLibrary {
  constructor({ recordingsDir, probeExecutable = "", fileSystem = fs, spawnSyncImpl = spawnSync }) {
    this.recordingsDir = recordingsDir;
    this.probeExecutable = probeExecutable;
    this.fs = fileSystem;
    this.spawnSync = spawnSyncImpl;
    this.durationCache = new Map();
  }

  ensureDirectory() {
    this.fs.mkdirSync(this.recordingsDir, { recursive: true });
  }

  list() {
    this.ensureDirectory();
    const recordings = [];
    for (const fileName of this.fs.readdirSync(this.recordingsDir)) {
      const id = safeRecordingId(fileName);
      if (!id) continue;
      const filePath = path.join(this.recordingsDir, id);
      let stat;
      try { stat = this.fs.statSync(filePath); } catch { continue; }
      if (!stat.isFile()) continue;
      recordings.push(this.toRecording(id, filePath, stat));
    }
    return recordings.sort((a, b) => (
      Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) || a.fileName.localeCompare(b.fileName)
    ));
  }

  get(recordingId) {
    const id = safeRecordingId(recordingId);
    if (!id) return null;
    const filePath = path.join(this.recordingsDir, id);
    try {
      const stat = this.fs.statSync(filePath);
      if (!stat.isFile()) return null;
      return this.toRecording(id, filePath, stat);
    } catch {
      return null;
    }
  }

  durationFor(filePath, stat) {
    if (!this.probeExecutable) return null;
    const cacheKey = `${filePath}:${stat.size}:${stat.mtimeMs}`;
    if (this.durationCache.has(cacheKey)) return this.durationCache.get(cacheKey);
    let duration = null;
    try {
      const result = this.spawnSync(this.probeExecutable, [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath
      ], { encoding: "utf8", timeout: 5000, windowsHide: true });
      const parsed = Number.parseFloat(String(result.stdout || "").trim());
      if (result.status === 0 && Number.isFinite(parsed) && parsed >= 0) {
        duration = Math.round(parsed);
      }
    } catch {}
    this.durationCache.set(cacheKey, duration);
    return duration;
  }

  toRecording(id, filePath, stat) {
    return {
      id,
      fileName: id,
      name: displayName(id),
      path: filePath,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      durationSeconds: this.durationFor(filePath, stat)
    };
  }
}

module.exports = { RecordingLibrary, displayName, safeRecordingId };
