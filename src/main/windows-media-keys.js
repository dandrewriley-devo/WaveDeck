const MEDIA_KEY_BINDINGS = [
  ["MediaPlayPause", "togglePlayPause"],
  ["MediaNextTrack", "nextPreset"],
  ["MediaPreviousTrack", "previousPreset"],
  ["MediaStop", "stop"]
];

class WindowsMediaKeys {
  constructor({ controller, globalShortcut, platform = process.platform, onWarning } = {}) {
    this.controller = controller;
    this.globalShortcut = globalShortcut;
    this.platform = platform;
    this.onWarning = onWarning || (() => {});
    this.registered = new Set();
  }

  async start() {
    if (this.platform !== "win32" || !this.globalShortcut) return false;
    return this.claim();
  }

  async claim() {
    if (this.platform !== "win32" || !this.globalShortcut) return false;

    for (const [accelerator, action] of MEDIA_KEY_BINDINGS) {
      if (this.globalShortcut.isRegistered(accelerator)) {
        this.registered.add(accelerator);
        continue;
      }

      let registered = false;
      try {
        registered = this.globalShortcut.register(accelerator, () => {
          void Promise.resolve(this.controller?.[action]?.()).catch((error) => {
            this.onWarning(`Windows media key ${accelerator} failed: ${error.message}`);
          });
        });
      } catch (error) {
        this.onWarning(`Windows could not register ${accelerator}: ${error.message}`);
      }

      if (registered) this.registered.add(accelerator);
    }

    return this.registered.size > 0;
  }

  close() {
    for (const accelerator of this.registered) {
      try { this.globalShortcut?.unregister(accelerator); } catch {}
    }
    this.registered.clear();
  }
}

module.exports = { MEDIA_KEY_BINDINGS, WindowsMediaKeys };
