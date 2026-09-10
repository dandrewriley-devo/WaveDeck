const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_START_TIMEOUT_MS = 6_000;
const DEFAULT_STOP_TIMEOUT_MS = 2_000;

function calculateWindowsSidebarBounds(display, logicalWidth = 300) {
  if (!display?.workArea) {
    throw new Error("No display is available for Windows Sidebar Mode.");
  }

  const workArea = display.workArea;
  const availableWidth = Math.max(1, Math.round(Number(workArea.width) || 0));
  const requestedWidth = Math.max(200, Math.round(Number(logicalWidth) || 300));
  const width = Math.min(availableWidth, requestedWidth);
  const height = Math.max(1, Math.round(Number(workArea.height) || 0));
  return {
    x: Math.round(Number(workArea.x) || 0) + availableWidth - width,
    y: Math.round(Number(workArea.y) || 0),
    width,
    height
  };
}

function resolveWindowsSidebarHelper({ packaged, resourcesPath, projectRoot }) {
  return packaged
    ? path.join(resourcesPath, "native", "WaveDeckSidebar.exe")
    : path.join(projectRoot, "native", "windows", "bin", "WaveDeckSidebar.exe");
}

function nativeWindowHandleString(window) {
  const handle = window?.getNativeWindowHandle?.();
  if (!Buffer.isBuffer(handle) || handle.length < 4) {
    throw new Error("WaveDeck could not identify its Windows desktop window.");
  }
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString();
  return String(handle.readUInt32LE(0));
}

function parseReadyLine(value) {
  const fields = String(value ?? "").trim().split("|");
  if (fields[0] !== "READY" || fields.length !== 5) return null;
  const [x, y, width, height] = fields.slice(1).map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) return null;
  return { x, y, width, height };
}

class WindowsSidebar {
  constructor({ helperPath, spawnImpl = spawn, startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS, onUnexpectedExit = () => {} } = {}) {
    this.helperPath = helperPath;
    this.spawnImpl = spawnImpl;
    this.startTimeoutMs = startTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.onUnexpectedExit = onUnexpectedExit;
    this.child = null;
    this.active = false;
  }

  isAvailable() {
    return Boolean(this.helperPath && fs.existsSync(this.helperPath));
  }

  async apply(window, logicalWidth) {
    if (!this.isAvailable()) {
      throw new Error("The Windows Sidebar component is missing from this copy of WaveDeck.");
    }
    await this.remove();

    const handle = nativeWindowHandleString(window);
    const width = Math.max(200, Math.round(Number(logicalWidth) || 300));
    const child = this.spawnImpl(this.helperPath, [handle, String(width)], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    return new Promise((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = "";
      let stderrBuffer = "";
      const timer = setTimeout(() => {
        finish(new Error("Windows did not finish reserving space for Sidebar Mode."));
      }, this.startTimeoutMs);

      const finish = (error, bounds = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          if (this.child === child) this.child = null;
          this.active = false;
          try { child.kill(); } catch {}
          reject(error);
          return;
        }
        this.active = true;
        resolve(bounds);
      };

      child.once("error", (error) => finish(new Error(`Windows could not start Sidebar Mode: ${error.message}`)));
      child.once("exit", (code) => {
        const unexpected = this.child === child && this.active;
        if (this.child === child) this.child = null;
        this.active = false;
        if (unexpected) this.onUnexpectedExit({ code });
        if (!settled) {
          const detail = stderrBuffer.trim();
          finish(new Error(detail || `The Windows Sidebar component stopped unexpectedly (${code ?? "unknown"}).`));
        }
      });
      child.stderr?.on("data", (chunk) => {
        stderrBuffer = `${stderrBuffer}${chunk}`.slice(-4_000);
      });
      child.stdout?.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        let newline;
        while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.slice(0, newline).trim();
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          const bounds = parseReadyLine(line);
          if (bounds) return finish(null, bounds);
          if (line.startsWith("ERROR|")) {
            return finish(new Error(line.slice(6).trim() || "Windows rejected Sidebar Mode."));
          }
        }
      });
    });
  }

  async remove() {
    const child = this.child;
    if (!child) {
      this.active = false;
      return true;
    }

    this.child = null;
    this.active = false;
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish();
      }, this.stopTimeoutMs);
      child.once("exit", finish);
      child.once("error", finish);
      try {
        child.stdin?.end("REMOVE\n");
      } catch {
        try { child.kill(); } catch {}
        finish();
      }
    });
  }

  close() {
    const child = this.child;
    this.child = null;
    this.active = false;
    if (!child) return;
    try { child.stdin?.end("REMOVE\n"); } catch {}
  }
}

module.exports = {
  WindowsSidebar,
  calculateWindowsSidebarBounds,
  nativeWindowHandleString,
  parseReadyLine,
  resolveWindowsSidebarHelper
};
