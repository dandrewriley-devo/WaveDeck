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
    this.startPromise = null;
    this.signalHandler = null;
    this.closed = false;
    this.generation = 0;
  }

  start() {
    if (this.platform !== "linux" || this.closed) return Promise.resolve(false);
    if (this.interface) return this.claim();
    if (this.startPromise) return this.startPromise;

    const generation = ++this.generation;
    const bus = this.busFactory();
    let adopted = false;
    const operation = (async () => {
      try {
        const object = await bus.getProxyObject(SERVICE_NAME, OBJECT_PATH);
        if (this.closed || generation !== this.generation) {
          this.#disconnectBus(bus);
          return false;
        }
        const mediaKeys = object.getInterface(INTERFACE_NAME);
        const signalHandler = (_application, key) => {
          const method = KEY_COMMANDS[String(key)];
          if (!method || typeof this.controller?.[method] !== "function") return;
          void Promise.resolve().then(() => this.controller[method]()).catch((error) => {
            this.onWarning(`Cinnamon media key failed: ${error.message}`);
          });
        };
        mediaKeys.on("MediaPlayerKeyPressed", signalHandler);
        this.bus = bus;
        this.interface = mediaKeys;
        this.signalHandler = signalHandler;
        adopted = true;
        return await this.claim();
      } catch (error) {
        if (!adopted || this.bus === bus) this.#disconnectConnection(bus);
        if (!this.closed) this.onWarning(`Cinnamon media-key integration is unavailable: ${error.message}`);
        return false;
      }
    })();
    const wrapped = operation.finally(() => {
      if (this.startPromise === wrapped) this.startPromise = null;
    });
    this.startPromise = wrapped;
    return wrapped;
  }

  async claim({ reconnect = false } = {}) {
    if (this.closed || this.platform !== "linux") return false;
    if (!this.interface) return reconnect ? this.start() : false;
    if (this.claimPromise) return this.claimPromise;

    const mediaKeys = this.interface;
    const bus = this.bus;
    const operation = Promise.resolve(
      mediaKeys.GrabMediaPlayerKeys(this.applicationName, 0)
    ).then(() => true).catch((error) => {
      this.#disconnectConnection(bus, mediaKeys);
      throw error;
    });
    const wrapped = operation.finally(() => {
      if (this.claimPromise === wrapped) this.claimPromise = null;
    });
    this.claimPromise = wrapped;
    return wrapped;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    const mediaKeys = this.interface;
    const bus = this.bus;
    this.#detach(mediaKeys);
    if (!mediaKeys) {
      this.#disconnectConnection(bus);
      return;
    }
    void Promise.resolve(mediaKeys.ReleaseMediaPlayerKeys(this.applicationName))
      .catch(() => {})
      .finally(() => this.#disconnectConnection(bus, mediaKeys));
  }

  #detach(mediaKeys = this.interface) {
    if (mediaKeys && this.signalHandler) {
      try { mediaKeys.off("MediaPlayerKeyPressed", this.signalHandler); } catch {}
    }
    if (!mediaKeys || this.interface === mediaKeys) {
      this.interface = null;
      this.signalHandler = null;
    }
  }

  #disconnectConnection(bus, mediaKeys = null) {
    this.#detach(mediaKeys || (this.bus === bus ? this.interface : null));
    if (this.bus === bus) this.bus = null;
    this.#disconnectBus(bus);
  }

  #disconnectBus(bus) {
    try { bus?.disconnect(); } catch {}
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
