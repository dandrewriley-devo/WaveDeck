const fs = require("fs");
const path = require("path");

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
  constructor({ recordingsDir, fileSystem = fs }) {
    this.recordingsDir = recordingsDir;
    this.fs = fileSystem;
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
      recordings.push({
        id,
        fileName: id,
        name: displayName(id),
        path: filePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
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
      return {
        id,
        fileName: id,
        name: displayName(id),
        path: filePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    } catch {
      return null;
    }
  }
}

module.exports = { RecordingLibrary, displayName, safeRecordingId };
