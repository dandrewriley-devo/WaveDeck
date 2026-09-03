const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

function getIpcPath(platform, dataDir, processId = process.pid) {
  if (platform === "win32") {
    return `\\\\.\\pipe\\wavedeck-${processId}`;
  }
  return path.join(dataDir, `mpv-${processId}.sock`);
}

function getMpvExecutable({ platform, packaged, resourcesPath, projectRoot }) {
  if (process.env.WAVEDECK_MPV_PATH) return process.env.WAVEDECK_MPV_PATH;
  if (platform === "win32") {
    return packaged
      ? path.join(resourcesPath, "playback", "mpv.exe")
      : path.join(projectRoot, "playback", "win32", "mpv.exe");
  }
  return "mpv";
}

function normalizeBitrateKbps(value, { assumeBitsPerSecond = false } = {}) {
  const match = String(value ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  let bitrate = Number(match[0]);
  if (!Number.isFinite(bitrate) || bitrate <= 0) return null;
  if (assumeBitsPerSecond || bitrate >= 8000) bitrate /= 1000;
  bitrate = Math.round(bitrate);
  return bitrate >= 8 && bitrate <= 3000 ? bitrate : null;
}

function bitrateFromMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const entries = Object.entries(metadata);
  const find = (...keys) => entries.find(([key]) => keys.includes(String(key).toLowerCase()))?.[1];
  return normalizeBitrateKbps(find("icy-br", "ice-bitrate", "bitrate", "audio-bitrate"));
}

function bitrateFromTrackList(trackList) {
  if (!Array.isArray(trackList)) return null;
  const audioTracks = trackList.filter((track) => track && track.type === "audio");
  const track = audioTracks.find((item) => item.selected) || audioTracks[0];
  if (!track) return null;
  return normalizeBitrateKbps(
    track["demux-bitrate"] ?? track.bitrate ?? track["audio-bitrate"],
    { assumeBitsPerSecond: true }
  );
}

class MpvPlayer {
  constructor({ executable, ipcPath, platform = process.platform, onMetadata, onStatus }) {
    this.executable = executable;
    this.ipcPath = ipcPath;
    this.platform = platform;
    this.onMetadata = onMetadata || (() => {});
    this.onStatus = onStatus || (() => {});

    this.process = null;
    this.socket = null;
    this.socketBuffer = "";
    this.requestId = 1;
    this.pending = new Map();
    this.connectTimer = null;
    this.startPromise = null;
    this.stopping = false;
    this.playSequence = 0;
    this.status = {
      state: "stopped",
      message: "Playback engine is stopped.",
      bitrateKbps: null,
      bitrateResolved: false
    };
  }

  getStatus() {
    return { ...this.status };
  }

  async refreshPlaybackState() {
    if (!this.socket || this.socket.destroyed) return this.getStatus();
    const result = await this.command(["get_property", "idle-active"], 4000);
    const playing = result.data === false;
    this.#setStatus(
      playing ? "playing" : "ready",
      playing ? "Playing." : "Playback engine is ready.",
      { playing }
    );
    return this.getStatus();
  }

  async start() {
    if (this.socket && !this.socket.destroyed) return true;
    if (this.startPromise) return this.startPromise;

    this.stopping = false;
    this.#setStatus("starting", "Starting playback engine…");
    this.startPromise = this.#startInternal();

    try {
      await this.startPromise;
      return true;
    } finally {
      this.startPromise = null;
    }
  }

  async #startInternal() {
    if (this.platform !== "win32") {
      try {
        if (fs.existsSync(this.ipcPath)) fs.unlinkSync(this.ipcPath);
      } catch {}
    } else if (!fs.existsSync(this.executable)) {
      return this.#failStart(`The bundled playback engine is missing: ${this.executable}`);
    }

    let startupError = "";
    try {
      this.process = spawn(this.executable, [
        "--idle=yes",
        "--no-video",
        "--force-window=no",
        "--audio-display=no",
        "--no-ytdl",
        "--network-timeout=10",
        "--cache=yes",
        `--input-ipc-server=${this.ipcPath}`
      ], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
      });
    } catch (error) {
      return this.#failStart(`Could not launch the playback engine: ${error.message}`);
    }

    this.process.once("error", (error) => {
      startupError = error.message;
      this.#handleProcessExit(null, null, error);
    });

    this.process.stderr?.on("data", (data) => {
      const line = data.toString().trim();
      if (line) console.error("[mpv]", line);
    });

    this.process.once("exit", (code, signal) => this.#handleProcessExit(code, signal));

    try {
      await this.#connect(10000);
    } catch (error) {
      try { this.process?.kill(); } catch {}
      const detail = startupError || error.message;
      return this.#failStart(`Playback engine did not start: ${detail}`);
    }

    await Promise.all([
      this.command(["observe_property", 1, "media-title"]),
      this.command(["observe_property", 2, "metadata"]),
      this.command(["observe_property", 3, "mute"]),
      this.command(["observe_property", 4, "volume"]),
      this.command(["observe_property", 5, "idle-active"]),
      this.command(["observe_property", 6, "audio-bitrate"]).catch(() => null),
      this.command(["observe_property", 7, "track-list"]).catch(() => null)
    ]);

    this.#setStatus("ready", "Playback engine is ready.");
    return true;
  }

  #connect(timeoutMs) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (this.stopping) return reject(new Error("Playback engine stopped."));
        if (!this.process) return reject(new Error("Playback engine exited."));
        if (Date.now() - startedAt >= timeoutMs) {
          return reject(new Error("IPC connection timed out."));
        }

        const socket = net.createConnection(this.ipcPath);
        let connected = false;

        socket.once("connect", () => {
          connected = true;
          this.socket = socket;
          this.socket.setEncoding("utf8");
          this.socket.on("data", (chunk) => this.#onData(chunk));
          this.socket.on("close", () => {
            if (this.socket === socket) this.socket = null;
          });
          this.socket.on("error", (error) => {
            if (!this.stopping) this.#setStatus("error", `Playback connection failed: ${error.message}`);
          });
          resolve();
        });

        socket.once("error", () => {
          socket.destroy();
          if (!connected) this.connectTimer = setTimeout(attempt, 175);
        });
      };

      attempt();
    });
  }

  #onData(chunk) {
    this.socketBuffer += chunk;
    let newline;

    while ((newline = this.socketBuffer.indexOf("\n")) >= 0) {
      const line = this.socketBuffer.slice(0, newline).trim();
      this.socketBuffer = this.socketBuffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (message.event === "property-change") this.#handleProperty(message);

      if (message.request_id && this.pending.has(message.request_id)) {
        const pending = this.pending.get(message.request_id);
        this.pending.delete(message.request_id);
        clearTimeout(pending.timer);
        if (message.error && message.error !== "success") {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message);
        }
      }
    }
  }

  #handleProperty(message) {
    if (message.name === "metadata") {
      if (message.data?.["icy-title"]) this.onMetadata(String(message.data["icy-title"]));
      this.#updateBitrate(bitrateFromMetadata(message.data));
      return;
    }

    if (message.name === "media-title" && message.data) {
      this.onMetadata(String(message.data));
      return;
    }

    if (message.name === "mute") {
      this.#setStatus(this.status.state, this.status.message, { muted: Boolean(message.data) });
      return;
    }

    if (message.name === "volume" && Number.isFinite(message.data)) {
      this.#setStatus(this.status.state, this.status.message, { volume: Math.round(message.data) });
      return;
    }

    if (message.name === "audio-bitrate") {
      this.#updateBitrate(normalizeBitrateKbps(message.data, { assumeBitsPerSecond: true }));
      return;
    }

    if (message.name === "track-list") {
      this.#updateBitrate(bitrateFromTrackList(message.data));
      return;
    }

    if (message.name === "idle-active") {
      const playing = message.data === false;
      this.#setStatus(playing ? "playing" : "ready", playing ? "Playing." : "Playback engine is ready.", { playing });
      if (playing) void this.#probeBitrate(this.playSequence);
    }
  }

  async #probeBitrate(sequence) {
    const results = await Promise.allSettled([
      this.command(["get_property", "metadata"]),
      this.command(["get_property", "audio-bitrate"]),
      this.command(["get_property", "track-list"])
    ]);
    if (sequence !== this.playSequence) return;
    const candidates = [
      results[0].status === "fulfilled" ? bitrateFromMetadata(results[0].value.data) : null,
      results[1].status === "fulfilled"
        ? normalizeBitrateKbps(results[1].value.data, { assumeBitsPerSecond: true })
        : null,
      results[2].status === "fulfilled" ? bitrateFromTrackList(results[2].value.data) : null
    ];
    const bitrate = candidates.find((value) => value !== null) ?? null;
    if (bitrate !== null) this.#updateBitrate(bitrate);
    else this.#setStatus(this.status.state, this.status.message, { bitrateResolved: true });
  }

  #updateBitrate(bitrate) {
    if (!Number.isFinite(bitrate)) return;
    if (this.status.bitrateKbps === bitrate && this.status.bitrateResolved) return;
    this.#setStatus(this.status.state, this.status.message, {
      bitrateKbps: bitrate,
      bitrateResolved: true
    });
  }

  command(commandArray, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error("Playback engine is not connected."));
        return;
      }

      const requestId = this.requestId++;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Playback engine command timed out."));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ command: commandArray, request_id: requestId })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        reject(error);
      });
    });
  }

  async play(url) {
    await this.start();
    this.playSequence += 1;
    this.#setStatus("connecting", "Connecting to station…", {
      playing: false,
      bitrateKbps: null,
      bitrateResolved: false
    });
    await this.command(["loadfile", url, "replace"]);
    return true;
  }

  async stop() {
    await this.start();
    await this.command(["stop"]);
    this.#setStatus("ready", "Stopped.", { playing: false });
    return true;
  }

  async setVolume(value) {
    await this.start();
    const volume = Math.min(Math.max(Number(value) || 0, 0), 100);
    await this.command(["set_property", "volume", volume]);
    return volume;
  }

  async toggleMute() {
    await this.start();
    await this.command(["cycle", "mute"]);
    const result = await this.command(["get_property", "mute"]);
    const muted = Boolean(result.data);
    this.#setStatus(this.status.state, this.status.message, { muted });
    return muted;
  }

  close() {
    this.stopping = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Playback engine stopped."));
    }
    this.pending.clear();

    try { this.socket?.destroy(); } catch {}
    try { this.process?.kill(); } catch {}
    this.socket = null;
    this.process = null;

    if (this.platform !== "win32") {
      try {
        if (fs.existsSync(this.ipcPath)) fs.unlinkSync(this.ipcPath);
      } catch {}
    }
  }

  #handleProcessExit(code, signal, error) {
    this.process = null;
    try { this.socket?.destroy(); } catch {}
    this.socket = null;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Playback engine exited."));
    }
    this.pending.clear();

    if (!this.stopping) {
      const detail = error?.message || `exit code ${code ?? "?"}${signal ? ` (${signal})` : ""}`;
      this.#setStatus("error", `Playback engine stopped unexpectedly: ${detail}`);
    }
  }

  #failStart(message) {
    this.#setStatus("error", message);
    throw new Error(message);
  }

  #setStatus(state, message, extra = {}) {
    this.status = { ...this.status, state, message, ...extra };
    this.onStatus({ ...this.status });
  }
}

module.exports = {
  MpvPlayer,
  bitrateFromMetadata,
  bitrateFromTrackList,
  getIpcPath,
  getMpvExecutable,
  normalizeBitrateKbps
};
