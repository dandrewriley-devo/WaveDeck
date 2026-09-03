const dbus = require("dbus-next");

const { Interface, ACCESS_READ, ACCESS_READWRITE } = dbus.interface;
const { Variant } = dbus;

const BUS_NAME = "org.mpris.MediaPlayer2.wavedeck";
const OBJECT_PATH = "/org/mpris/MediaPlayer2";

function stationTrackPath(station) {
  const raw = String(station?.id || station?.name || "station");
  const safe = raw.replace(/[^A-Za-z0-9_]/g, "_") || "station";
  return `/com/a17press/wavedeck/station/${safe}`;
}

function metadataForStation(station) {
  if (!station) return {};
  return {
    "mpris:trackid": new Variant("o", stationTrackPath(station)),
    "xesam:title": new Variant("s", String(station.name || "WaveDeck")),
    "xesam:artist": new Variant("as", ["WaveDeck"]),
    "xesam:url": new Variant("s", String(station.url || ""))
  };
}

class MprisRootInterface extends Interface {
  constructor({ onRaise }) {
    super("org.mpris.MediaPlayer2");
    this.onRaise = onRaise || (() => {});
  }

  Raise() {
    this.onRaise();
  }

  Quit() {}

  get CanQuit() { return false; }
  get CanRaise() { return true; }
  get HasTrackList() { return false; }
  get Identity() { return "WaveDeck"; }
  get DesktopEntry() { return "wavedeck"; }
  get SupportedUriSchemes() { return ["http", "https"]; }
  get SupportedMimeTypes() { return ["audio/mpeg", "audio/aac", "audio/ogg"]; }
}

MprisRootInterface.configureMembers({
  properties: {
    CanQuit: { signature: "b", access: ACCESS_READ },
    CanRaise: { signature: "b", access: ACCESS_READ },
    HasTrackList: { signature: "b", access: ACCESS_READ },
    Identity: { signature: "s", access: ACCESS_READ },
    DesktopEntry: { signature: "s", access: ACCESS_READ },
    SupportedUriSchemes: { signature: "as", access: ACCESS_READ },
    SupportedMimeTypes: { signature: "as", access: ACCESS_READ }
  },
  methods: {
    Raise: { inSignature: "", outSignature: "" },
    Quit: { inSignature: "", outSignature: "" }
  }
});

class MprisPlayerInterface extends Interface {
  constructor({ controller, onError }) {
    super("org.mpris.MediaPlayer2.Player");
    this.controller = controller;
    this.onError = onError || (() => {});
    this._playbackStatus = "Stopped";
    this._metadata = {};
    this._volume = 1;
    this._loopStatus = "Playlist";
    this._shuffle = false;
  }

  async Next() { await this.#run(() => this.controller.nextPreset()); }
  async Previous() { await this.#run(() => this.controller.previousPreset()); }
  async Pause() { await this.#run(() => this.controller.pause()); }
  async PlayPause() { await this.#run(() => this.controller.togglePlayPause()); }
  async Stop() { await this.#run(() => this.controller.stop()); }
  async Play() { await this.#run(() => this.controller.play()); }
  Seek() {}
  SetPosition() {}
  async OpenUri(uri) { await this.#run(() => this.controller.playUrl(String(uri))); }

  async #run(action) {
    try {
      await action();
    } catch (error) {
      this.onError(error);
    }
  }

  update(status, station, presetCount) {
    const mediaState = status?.mediaState || "stopped";
    this._playbackStatus = mediaState === "playing"
      ? "Playing"
      : (mediaState === "paused" ? "Paused" : "Stopped");
    this._metadata = metadataForStation(station);
    if (Number.isFinite(status?.volume)) this._volume = Math.min(Math.max(status.volume / 100, 0), 1);

    Interface.emitPropertiesChanged(this, {
      PlaybackStatus: this._playbackStatus,
      Metadata: this._metadata,
      Volume: this._volume,
      CanGoNext: presetCount > 0,
      CanGoPrevious: presetCount > 0,
      CanPlay: presetCount > 0 || Boolean(station)
    });
  }

  get PlaybackStatus() { return this._playbackStatus; }
  get LoopStatus() { return this._loopStatus; }
  set LoopStatus(value) { this._loopStatus = String(value); }
  get Rate() { return 1; }
  get Shuffle() { return this._shuffle; }
  set Shuffle(value) { this._shuffle = Boolean(value); }
  get Metadata() { return this._metadata; }
  get Volume() { return this._volume; }
  set Volume(value) {
    const normalized = Math.min(Math.max(Number(value) || 0, 0), 1);
    this._volume = normalized;
    void this.controller.setVolume(normalized).catch(this.onError);
  }
  get Position() { return 0n; }
  get MinimumRate() { return 1; }
  get MaximumRate() { return 1; }
  get CanGoNext() { return this.controller.getPresets().length > 0; }
  get CanGoPrevious() { return this.controller.getPresets().length > 0; }
  get CanPlay() { return this.CanGoNext || Boolean(this.controller.getCurrentStation()); }
  get CanPause() { return true; }
  get CanSeek() { return false; }
  get CanControl() { return true; }
}

MprisPlayerInterface.configureMembers({
  properties: {
    PlaybackStatus: { signature: "s", access: ACCESS_READ },
    LoopStatus: { signature: "s", access: ACCESS_READWRITE },
    Rate: { signature: "d", access: ACCESS_READ },
    Shuffle: { signature: "b", access: ACCESS_READWRITE },
    Metadata: { signature: "a{sv}", access: ACCESS_READ },
    Volume: { signature: "d", access: ACCESS_READWRITE },
    Position: { signature: "x", access: ACCESS_READ },
    MinimumRate: { signature: "d", access: ACCESS_READ },
    MaximumRate: { signature: "d", access: ACCESS_READ },
    CanGoNext: { signature: "b", access: ACCESS_READ },
    CanGoPrevious: { signature: "b", access: ACCESS_READ },
    CanPlay: { signature: "b", access: ACCESS_READ },
    CanPause: { signature: "b", access: ACCESS_READ },
    CanSeek: { signature: "b", access: ACCESS_READ },
    CanControl: { signature: "b", access: ACCESS_READ }
  },
  methods: {
    Next: { inSignature: "", outSignature: "" },
    Previous: { inSignature: "", outSignature: "" },
    Pause: { inSignature: "", outSignature: "" },
    PlayPause: { inSignature: "", outSignature: "" },
    Stop: { inSignature: "", outSignature: "" },
    Play: { inSignature: "", outSignature: "" },
    Seek: { inSignature: "x", outSignature: "" },
    SetPosition: { inSignature: "ox", outSignature: "" },
    OpenUri: { inSignature: "s", outSignature: "" }
  }
});

class MprisService {
  constructor({ controller, platform = process.platform, onRaise, onWarning }) {
    this.controller = controller;
    this.platform = platform;
    this.onRaise = onRaise || (() => {});
    this.onWarning = onWarning || (() => {});
    this.bus = null;
    this.rootInterface = null;
    this.playerInterface = null;
  }

  async start() {
    if (this.platform !== "linux") return false;
    try {
      this.bus = dbus.sessionBus();
      const reply = await this.bus.requestName(BUS_NAME, dbus.NameFlag.DO_NOT_QUEUE);
      if (reply !== dbus.RequestNameReply.PRIMARY_OWNER && reply !== dbus.RequestNameReply.ALREADY_OWNER) {
        throw new Error("another WaveDeck media service already owns the controls");
      }

      this.rootInterface = new MprisRootInterface({ onRaise: this.onRaise });
      this.playerInterface = new MprisPlayerInterface({
        controller: this.controller,
        onError: (error) => this.onWarning(`Media key command failed: ${error.message}`)
      });
      this.bus.export(OBJECT_PATH, this.rootInterface);
      this.bus.export(OBJECT_PATH, this.playerInterface);
      this.update(this.controller.getStatus());
      return true;
    } catch (error) {
      try { this.bus?.disconnect(); } catch {}
      this.bus = null;
      this.onWarning(`Linux media-key integration is unavailable: ${error.message}`);
      return false;
    }
  }

  update(status = this.controller.getStatus()) {
    if (!this.playerInterface) return;
    this.playerInterface.update(
      status,
      this.controller.getCurrentStation(),
      this.controller.getPresets().length
    );
  }

  close() {
    if (!this.bus) return;
    try { this.bus.unexport(OBJECT_PATH); } catch {}
    void this.bus.releaseName(BUS_NAME).catch(() => {}).finally(() => {
      try { this.bus?.disconnect(); } catch {}
      this.bus = null;
    });
  }
}

module.exports = {
  BUS_NAME,
  MprisPlayerInterface,
  MprisRootInterface,
  MprisService,
  OBJECT_PATH,
  metadataForStation,
  stationTrackPath
};
