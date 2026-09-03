const dbus = require("dbus-next");

const APPLICATION_NAME = "WaveDeck";
const SERVICE_NAME = "org.gnome.SettingsDaemon.MediaKeys";
const OBJECT_PATH = "/org/gnome/SettingsDaemon/MediaKeys";
const INTERFACE_NAME = "org.gnome.SettingsDaemon.MediaKeys";

const KEY_COMMANDS = Object.freeze({
  Next: "nextPreset",
  Previous: "previousPreset",
  Play: "togglePlayPause",
  Pause: "pause",
  Stop: "stop"
});

class CinnamonMediaKeys {
  constructor({
    controller,
    applicationName = `${APPLICATION_NAME}-${process.pid}`,
    platform = process.platform,
    busFactory = () => dbus.sessionBus(),
    onWarning = () => {}
  }) {
    this.controller = controller;
    this.applicationName = applicationName;
    this.platform = platform;
    this.busFactory = busFactory;
    this.onWarning = onWarning;
    this.bus = null;
    this.interface = null;
    this.claimPromise = null;
    this.signalHandler = null;
  }

  async start() {
    if (this.platform !== "linux") return false;

    try {
      this.bus = this.busFactory();
      const object = await this.bus.getProxyObject(SERVICE_NAME, OBJECT_PATH);
      this.interface = object.getInterface(INTERFACE_NAME);
      this.signalHandler = (_application, key) => {
        const method = KEY_COMMANDS[String(key)];
        if (!method || typeof this.controller?.[method] !== "function") return;
        void Promise.resolve().then(() => this.controller[method]()).catch((error) => {
          this.onWarning(`Cinnamon media key failed: ${error.message}`);
        });
      };
      this.interface.on("MediaPlayerKeyPressed", this.signalHandler);
      await this.claim();
      return true;
    } catch (error) {
      this.#disconnect();
      this.onWarning(`Cinnamon media-key integration is unavailable: ${error.message}`);
      return false;
    }
  }

  async claim() {
    if (!this.interface) return false;
    if (this.claimPromise) return this.claimPromise;

    this.claimPromise = Promise.resolve(
      this.interface.GrabMediaPlayerKeys(this.applicationName, 0)
    ).then(() => true).finally(() => {
      this.claimPromise = null;
    });
    return this.claimPromise;
  }

  close() {
    const mediaKeys = this.interface;
    if (mediaKeys && this.signalHandler) {
      try { mediaKeys.off("MediaPlayerKeyPressed", this.signalHandler); } catch {}
    }
    this.interface = null;
    this.signalHandler = null;

    if (!mediaKeys) {
      this.#disconnect();
      return;
    }

    void Promise.resolve(mediaKeys.ReleaseMediaPlayerKeys(this.applicationName))
      .catch(() => {})
      .finally(() => this.#disconnect());
  }

  #disconnect() {
    try { this.bus?.disconnect(); } catch {}
    this.bus = null;
  }
}

module.exports = {
  APPLICATION_NAME,
  CinnamonMediaKeys,
  INTERFACE_NAME,
  KEY_COMMANDS,
  OBJECT_PATH,
  SERVICE_NAME
};
