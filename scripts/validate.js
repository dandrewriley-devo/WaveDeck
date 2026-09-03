const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");

const { copyLegacyData } = require("../src/main/data-migration");
const {
  MANAGED_MARKER,
  buildDesktopEntry,
  getLauncherPaths,
  getLauncherStatus,
  installLauncher,
  removeLauncher
} = require("../src/main/desktop-launcher");
const { resolveDataDir, resolveLegacyDataDirs, resolvePortableState } = require("../src/main/portable-paths");
const {
  calculateSidebarLayout,
  getX11WindowId
} = require("../src/main/sidebar");
const { cleanupCode, reservationCode, windowLookupCode } = require("../src/main/cinnamon-reservation");
const { MediaController } = require("../src/main/media-controller");
const { ListeningHistory } = require("../src/main/listening-history");
const {
  MpvPlayer,
  bitrateFromMetadata,
  bitrateFromTrackList,
  normalizeBitrateKbps
} = require("../src/main/player");
const { MprisPlayerInterface, metadataForStation, stationTrackPath } = require("../src/main/mpris");
const {
  CinnamonMediaKeys,
  INTERFACE_NAME,
  OBJECT_PATH: CINNAMON_MEDIA_KEYS_PATH,
  SERVICE_NAME
} = require("../src/main/cinnamon-media-keys");
const {
  PortableStorage,
  validateGroups,
  validateStations,
  validateSubgroups
} = require("../src/main/storage");
const { calculateBottomRightBounds, calculateCenteredBounds } = require("../src/main/window-layout");

const root = path.resolve(__dirname, "..");
const defaultsDir = path.join(root, "defaults");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const stations = validateStations(JSON.parse(fs.readFileSync(path.join(defaultsDir, "stations.json"), "utf8")));
const groups = validateGroups(JSON.parse(fs.readFileSync(path.join(defaultsDir, "groups.json"), "utf8")));

assert.strictEqual(packageJson.name, "wavedeck");
assert.strictEqual(packageJson.version, "0.2.2");
assert.strictEqual(packageJson.desktopName, "wavedeck.desktop");
assert.strictEqual(packageJson.build.productName, "WaveDeck");
assert.strictEqual(packageJson.dependencies.x11, "^4.1.0");
assert.strictEqual(packageJson.dependencies["dbus-next"], "^0.10.2");
assert.strictEqual(packageJson.build.linux.syncDesktopName, true);
assert.strictEqual(packageJson.build.linux.artifactName, "WaveDeck.${ext}");
assert.strictEqual(stations.length, 110);
assert.strictEqual(groups.length, 23);
assert.strictEqual(new Set(stations.map((station) => station.id)).size, 110);

assert.strictEqual(resolvePortableState({
  platform: "linux",
  isPackaged: true,
  appImagePath: "/media/USB/WaveDeck.AppImage"
}), true);
assert.strictEqual(resolvePortableState({
  platform: "linux",
  isPackaged: false,
  appImagePath: undefined
}), false);

assert.strictEqual(resolveDataDir({
  platform: "linux",
  isPackaged: true,
  appImagePath: "/media/USB/WaveDeck.AppImage",
  execPath: "/tmp/mount/wavedeck",
  projectRoot: "/source",
  homeDir: "/home/tester"
}), path.normalize("/media/USB/WaveDeck-Data"));

assert.deepStrictEqual(resolveLegacyDataDirs({
  platform: "linux",
  isPackaged: true,
  appImagePath: "/media/USB/WaveDeck Portable Linux/WaveDeck.AppImage",
  homeDir: "/home/tester"
}), [
  path.normalize("/media/USB/WaveDeck Portable Linux/WaveDeckSB-Data"),
  path.normalize("/media/USB/WaveDeckSB Portable Linux/WaveDeckSB-Data")
]);

assert.strictEqual(resolveDataDir({
  platform: "win32",
  isPackaged: true,
  execPath: "C:\\WaveDeck\\WaveDeck.exe",
  projectRoot: "C:\\source",
  homeDir: "C:\\Users\\tester"
}), path.win32.normalize("C:\\WaveDeck\\Data"));

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wavedeck-validate-"));
try {
  const dataDir = path.join(testRoot, "WaveDeck-Data");
  const storage = new PortableStorage({ dataDir, defaultsDir });
  storage.initialize();
  storage.assertWritable();
  assert.strictEqual(storage.readStations().length, 110);
  assert.strictEqual(storage.readGroups().length, 23);
  assert.deepStrictEqual(storage.readSubgroups(), { version: 1, groups: [] });

  const changed = storage.readStations();
  changed[0].favorite = !changed[0].favorite;
  storage.writeStations(changed);
  assert.strictEqual(storage.readStations()[0].favorite, changed[0].favorite);
  const customOrder = storage.readStations();
  customOrder[0].favorite = true;
  customOrder[0].favoriteOrder = 1;
  customOrder[1].favorite = true;
  customOrder[1].favoriteOrder = 0;
  storage.writeStations(customOrder);
  assert.strictEqual(storage.readStations()[0].favoriteOrder, 1);
  assert.strictEqual(storage.readStations()[1].favoriteOrder, 0);
  const legacyOrder = storage.readStations();
  legacyOrder[0].favorite = true;
  legacyOrder[0].favoriteOrder = null;
  storage.writeStations(legacyOrder);
  assert.strictEqual(storage.readStations()[0].favoriteOrder, null);
  assert.ok(fs.existsSync(path.join(dataDir, "backups", "stations.json.bak")));
  assert.strictEqual(storage.readNotepad(), "");
  storage.writeNotepad("Call Ben\nOrder filters");
  assert.strictEqual(storage.readNotepad(), "Call Ben\nOrder filters");
  const reloadedStorage = new PortableStorage({ dataDir, defaultsDir });
  reloadedStorage.initialize();
  assert.strictEqual(reloadedStorage.readNotepad(), "Call Ben\nOrder filters");
  assert.deepStrictEqual(reloadedStorage.readListeningHistory(), { version: 1, stations: {} });
  reloadedStorage.writeListeningHistory({
    version: 1,
    stations: { alpha: { seconds: 325, lastListenedAt: "2026-09-02T00:00:00.000Z" } }
  });
  assert.strictEqual(reloadedStorage.readListeningHistory().stations.alpha.seconds, 325);

  const subgroupStations = reloadedStorage.readStations();
  const subgroupGroup = subgroupStations[0].group;
  subgroupStations[0].subgroup = "Pacific Northwest";
  subgroupStations[0].description = "Independent alternative and local music.";
  subgroupStations[0].noPreRoll = true;
  reloadedStorage.writeStations(subgroupStations);
  reloadedStorage.syncSubgroupsWithStations(subgroupStations);
  assert.deepStrictEqual(reloadedStorage.readSubgroups().groups, [{
    group: subgroupGroup,
    subgroups: ["Pacific Northwest"]
  }]);
  assert.strictEqual(reloadedStorage.readStations()[0].description, "Independent alternative and local music.");
  assert.strictEqual(reloadedStorage.readStations()[0].noPreRoll, true);
  assert.strictEqual(reloadedStorage.renameSubgroup(subgroupGroup, "Pacific Northwest", "PNW").ok, true);
  assert.strictEqual(reloadedStorage.readStations()[0].subgroup, "PNW");
  assert.strictEqual(reloadedStorage.removeSubgroup(subgroupGroup, "PNW").ok, true);
  assert.strictEqual(reloadedStorage.readStations()[0].subgroup, "");

  const legacyDir = path.join(testRoot, "WaveDeckSB-Data");
  const legacyStorage = new PortableStorage({ dataDir: legacyDir, defaultsDir });
  legacyStorage.initialize();
  legacyStorage.writeNotepad("Legacy note remains intact");
  const migratedDir = path.join(testRoot, "Migrated-WaveDeck-Data");
  const migration = copyLegacyData({ legacyDirs: [legacyDir], targetDir: migratedDir });
  assert.ok(migration.copied.length >= 3);
  assert.strictEqual(fs.readFileSync(path.join(migratedDir, "notepad.txt"), "utf8"), "Legacy note remains intact");
  assert.strictEqual(fs.readFileSync(path.join(legacyDir, "notepad.txt"), "utf8"), "Legacy note remains intact");
  assert.strictEqual(copyLegacyData({ legacyDirs: [legacyDir], targetDir: migratedDir }).copied.length, 0);

  const fakeAppImage = path.join(testRoot, "WaveDeck Portable", "WaveDeck.AppImage");
  const nextFakeAppImage = path.join(testRoot, "WaveDeck Portable", "WaveDeck Next.AppImage");
  const fakeIcon = path.join(testRoot, "icon.png");
  fs.mkdirSync(path.dirname(fakeAppImage), { recursive: true });
  fs.writeFileSync(fakeAppImage, "appimage");
  fs.writeFileSync(nextFakeAppImage, "next-appimage");
  fs.writeFileSync(fakeIcon, "png-icon");

  const desktopEntry = buildDesktopEntry({ appImagePath: fakeAppImage, version: "0.1.14" });
  assert.ok(desktopEntry.includes(`Exec="${fakeAppImage}"`));
  assert.ok(desktopEntry.includes("Icon=wavedeck"));
  assert.ok(desktopEntry.includes("StartupWMClass=wavedeck"));
  assert.ok(desktopEntry.includes(MANAGED_MARKER));

  const installedLauncher = installLauncher({
    homeDir: testRoot,
    appImagePath: fakeAppImage,
    iconSourcePath: fakeIcon,
    version: "0.1.14"
  });
  assert.strictEqual(installedLauncher.installed, true);
  assert.strictEqual(installedLauncher.managed, true);
  assert.strictEqual(installedLauncher.current, true);
  assert.strictEqual(fs.statSync(installedLauncher.launcherPath).mode & 0o777, 0o755);
  assert.strictEqual(fs.statSync(installedLauncher.iconPath).mode & 0o777, 0o644);
  assert.strictEqual(fs.readFileSync(installedLauncher.iconPath, "utf8"), "png-icon");

  const updatedLauncher = installLauncher({
    homeDir: testRoot,
    appImagePath: nextFakeAppImage,
    iconSourcePath: fakeIcon,
    version: "0.1.14"
  });
  assert.strictEqual(updatedLauncher.current, true);
  assert.ok(fs.readFileSync(updatedLauncher.launcherPath, "utf8").includes(`Exec="${nextFakeAppImage}"`));
  assert.strictEqual(getLauncherStatus({ homeDir: testRoot, appImagePath: fakeAppImage }).current, false);

  const removedLauncher = removeLauncher({ homeDir: testRoot, appImagePath: nextFakeAppImage });
  assert.strictEqual(removedLauncher.installed, false);
  assert.strictEqual(fs.existsSync(updatedLauncher.iconPath), false);

  const launcherPaths = getLauncherPaths(testRoot);
  fs.mkdirSync(launcherPaths.applicationsDir, { recursive: true });
  fs.writeFileSync(launcherPaths.launcherPath, "[Desktop Entry]\nName=Custom WaveDeck\n");
  assert.throws(
    () => installLauncher({
      homeDir: testRoot,
      appImagePath: fakeAppImage,
      iconSourcePath: fakeIcon,
      version: "0.1.14"
    }),
    /will not overwrite/
  );
  assert.throws(
    () => removeLauncher({ homeDir: testRoot, appImagePath: fakeAppImage }),
    /left untouched/
  );
  assert.ok(fs.readFileSync(launcherPaths.launcherPath, "utf8").includes("Custom WaveDeck"));
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}

const primary = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 28, width: 1920, height: 1052 }
};

let historyTime = 0;
const historyWrites = [];
const historyChanges = [];
let nextTimerId = 1;
const historyTimers = new Map();
const historyStorage = {
  readListeningHistory: () => ({ version: 1, stations: {} }),
  writeListeningHistory: (history) => {
    historyWrites.push(JSON.parse(JSON.stringify(history)));
    return history;
  }
};
const listeningHistory = new ListeningHistory({
  storage: historyStorage,
  onChanged: (history) => historyChanges.push(history),
  now: () => historyTime,
  minimumSessionMs: 30_000,
  flushIntervalMs: 30_000,
  setTimer: (callback) => {
    const id = nextTimerId++;
    historyTimers.set(id, callback);
    return id;
  },
  clearTimer: (id) => historyTimers.delete(id)
});
const playingAlpha = {
  state: "playing",
  playing: true,
  mediaState: "playing",
  currentStation: { id: "alpha", name: "Alpha", url: "https://example.com/alpha" }
};
listeningHistory.handleStatus(playingAlpha);
historyTime = 29_000;
assert.deepStrictEqual(listeningHistory.getStats().stations, {});
historyTime = 30_000;
assert.strictEqual(listeningHistory.getStats().stations.alpha.seconds, 30);
historyTime = 44_500;
listeningHistory.handleStatus({ ...playingAlpha, state: "ready", playing: false, mediaState: "paused" });
assert.strictEqual(listeningHistory.getStats().stations.alpha.seconds, 44);
historyTime = 50_000;
listeningHistory.handleStatus({
  ...playingAlpha,
  currentStation: { ...playingAlpha.currentStation, name: "Alpha Renamed", url: "https://new.example/alpha" }
});
historyTime = 70_000;
listeningHistory.handleStatus({ ...playingAlpha, state: "ready", playing: false, mediaState: "paused" });
assert.strictEqual(listeningHistory.getStats().stations.alpha.seconds, 44);
assert.ok(historyWrites.length >= 2);
assert.ok(historyChanges.length >= 2);
assert.deepStrictEqual(listeningHistory.reset().stations, {});
listeningHistory.close();

let indieTime = 0;
const indieWrites = [];
const indieHistory = new ListeningHistory({
  storage: {
    readListeningHistory: () => ({ version: 1, stations: {} }),
    writeListeningHistory: (history) => {
      indieWrites.push(JSON.parse(JSON.stringify(history)));
      return history;
    }
  },
  now: () => indieTime,
  minimumSessionMs: 30_000,
  flushIntervalMs: 30_000,
  setTimer: () => 1,
  clearTimer: () => {}
});
const indieStatusWithoutPlayingEvent = {
  state: "ready",
  playing: false,
  mediaState: "playing",
  currentStation: {
    id: "st_mtjk2dw5_kn5p33sb",
    name: "IndieXL",
    url: "https://server-23.stream-server.nl:18438/"
  }
};
indieHistory.handleStatus(indieStatusWithoutPlayingEvent);
indieTime = 50 * 60 * 1000;
assert.strictEqual(indieHistory.getStats().stations.st_mtjk2dw5_kn5p33sb.seconds, 3000);
indieHistory.handleStatus({ ...indieStatusWithoutPlayingEvent, mediaState: "paused" });
indieTime = 60 * 60 * 1000;
assert.strictEqual(indieHistory.getStats().stations.st_mtjk2dw5_kn5p33sb.seconds, 3000);
assert.ok(indieWrites.length >= 1);
indieHistory.close();
assert.strictEqual(normalizeBitrateKbps("128 kb/s"), 128);
assert.strictEqual(normalizeBitrateKbps(192000, { assumeBitsPerSecond: true }), 192);
assert.strictEqual(bitrateFromMetadata({ "icy-br": "320" }), 320);
assert.strictEqual(bitrateFromTrackList([{ type: "audio", selected: true, "demux-bitrate": 256000 }]), 256);
assert.strictEqual(bitrateFromMetadata({ title: "No bitrate here" }), null);
assert.deepStrictEqual(validateSubgroups({
  groups: [
    { group: "International", subgroups: ["Canada", "canada", "UK"] },
    { group: "international", subgroups: ["Ignored duplicate group"] }
  ]
}), {
  version: 1,
  groups: [{ group: "International", subgroups: ["Canada", "UK"] }]
});
assert.deepStrictEqual(
  calculateBottomRightBounds(primary, 300, 600),
  { x: 1620, y: 480, width: 300, height: 600 }
);
assert.deepStrictEqual(
  calculateCenteredBounds(primary, 860, 620),
  { x: 530, y: 244, width: 860, height: 620 }
);
const sidebarLayout = calculateSidebarLayout(primary, [primary]);
assert.deepStrictEqual(sidebarLayout.bounds, { x: 1620, y: 28, width: 300, height: 1052 });
assert.strictEqual(sidebarLayout.canUseDesktopStrut, true);
assert.deepStrictEqual(sidebarLayout.strut, [0, 300, 0, 0]);
assert.deepStrictEqual(
  sidebarLayout.partialStrut,
  [0, 300, 0, 0, 0, 0, 28, 1079, 0, 0, 0, 0]
);
assert.strictEqual(getX11WindowId({
  getNativeWindowHandle: () => Buffer.from([0x78, 0x56, 0x34, 0x12])
}), 0x12345678);
const internalMonitorLayout = calculateSidebarLayout(primary, [
  primary,
  {
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1920, y: 28, width: 1920, height: 1052 }
  }
]);
assert.deepStrictEqual(internalMonitorLayout.bounds, { x: 1620, y: 28, width: 300, height: 1052 });
assert.strictEqual(internalMonitorLayout.canUseDesktopStrut, false);

const SIDEBAR_NATIVE_TITLE = "WaveDeck Sidebar";
const cinnamonReservation = reservationCode(4321, SIDEBAR_NATIVE_TITLE);
assert.ok(cinnamonReservation.includes("affectsStruts: true"));
assert.ok(cinnamonReservation.includes("global.get_window_actors()"));
assert.ok(cinnamonReservation.includes("var monitorIndex = bestWindow.get_monitor()"));
assert.ok(cinnamonReservation.includes("workspace.get_work_area_for_monitor(monitorIndex)"));
assert.ok(cinnamonReservation.includes("Math.min(floatingRect.width, workArea.width)"));
assert.ok(!cinnamonReservation.includes("Math.min(300, workArea.width)"));
assert.ok(cinnamonReservation.includes("global._waveDeckSBApplyDockGeometry"));
assert.ok(cinnamonReservation.includes("global._waveDeckSBSettleCount"));
assert.ok(cinnamonReservation.includes("global._waveDeckSBCreateStrut"));
assert.ok(cinnamonReservation.includes("target.move_resize_frame(false, desired.x, desired.y, desired.width, desired.height)"));
assert.ok(cinnamonReservation.includes("Mainloop.timeout_add(200"));
assert.ok(cinnamonReservation.includes("Mainloop.timeout_add_seconds(1"));
assert.ok(cinnamonReservation.includes("candidate.get_pid()"));
assert.ok(cinnamonReservation.includes('title === "WaveDeck Sidebar"'));
assert.ok(cinnamonReservation.includes("bestWindow.get_window_type() !== Meta.WindowType.DOCK"));
assert.ok(cinnamonReservation.includes("actor.set_position(desired.x, desired.y)"));
assert.ok(cinnamonReservation.includes("actor.set_size(desired.width, desired.height)"));
assert.ok(cinnamonReservation.includes("affectsInputRegion: false"));
assert.ok(cinnamonReservation.includes("Main.layoutManager._chrome.updateRegions()"));
assert.ok(
  cinnamonReservation.indexOf("Main.layoutManager._chrome.updateRegions()") <
  cinnamonReservation.indexOf("workspace.get_work_area_for_monitor(monitorIndex)")
);
assert.ok(cinnamonReservation.includes('/proc/4321'));
const cinnamonCleanup = cleanupCode(4321, true, SIDEBAR_NATIVE_TITLE);
assert.ok(cinnamonCleanup.includes("removeChrome"));
assert.ok(cinnamonCleanup.includes("bestWindow.move_resize_frame(false, saved.x, saved.y, saved.width, saved.height)"));
assert.ok(windowLookupCode(4321, SIDEBAR_NATIVE_TITLE).includes("candidatePid === 4321"));
assert.ok(windowLookupCode(4321, SIDEBAR_NATIVE_TITLE).includes('title === "WaveDeck Sidebar"'));
assert.doesNotThrow(() => new Function(`return ${cinnamonReservation};`));
assert.doesNotThrow(() => new Function(`return ${cinnamonCleanup};`));

const cinnamonCalls = [];
class MockWidget {
  set_position(x, y) {
    this.position = { x, y };
  }

  set_size(width, height) {
    this.size = { width, height };
  }

  destroy() {
    cinnamonCalls.push(["destroy"]);
  }
}

let mockCurrentFrame = { x: -620, y: 40, width: 198, height: 600 };
const mockMetaWindow = {
  get_pid: () => 4321,
  get_title: () => SIDEBAR_NATIVE_TITLE,
  get_wm_class: () => "wavedeck",
  get_window_type: () => 7,
  get_frame_rect: () => ({ ...mockCurrentFrame }),
  get_monitor: () => 2,
  unmaximize: (flags) => cinnamonCalls.push(["unmaximize", flags]),
  move_resize_frame: (...args) => {
    cinnamonCalls.push(["move_resize_frame", ...args]);
    mockCurrentFrame = {
      x: args[1],
      y: args[2],
      width: args[3],
      height: args[4]
    };
  }
};

const mockMain = {
  layoutManager: {
    _chrome: {
      updateRegions: () => cinnamonCalls.push(["updateRegions"])
    },
    addChrome: (actor, params) => cinnamonCalls.push(["addChrome", actor, params]),
    removeChrome: () => cinnamonCalls.push(["removeChrome"]),
    updateChrome: () => cinnamonCalls.push(["updateChrome"])
  }
};

const mockGlobal = {
  get_window_actors: () => [{
    meta_window: {
      get_pid: () => 4321,
      get_title: () => "WaveDeck",
      get_wm_class: () => "wavedeck",
      get_window_type: () => 0
    }
  }, { meta_window: mockMetaWindow }],
  workspace_manager: {
    get_active_workspace: () => ({
      get_work_area_for_monitor: (monitorIndex) => {
        assert.strictEqual(monitorIndex, 2);
        return { x: 3840, y: 32, width: 2560, height: 1408 };
      }
    })
  }
};

const cinnamonContext = {
  global: mockGlobal,
  imports: {
    ui: { main: mockMain },
    mainloop: {
      source_remove: (id) => cinnamonCalls.push(["source_remove", id]),
      timeout_add: (milliseconds, callback) => {
        cinnamonCalls.push(["timeout_add", milliseconds, callback]);
        return 77;
      },
      timeout_add_seconds: (seconds, callback) => {
        cinnamonCalls.push(["timeout_add_seconds", seconds, callback]);
        return 99;
      }
    },
    gi: {
      GLib: { file_test: () => true, FileTest: { EXISTS: 1 } },
      Meta: { MaximizeFlags: { BOTH: 3 }, WindowType: { DOCK: 7 } },
      St: { Widget: MockWidget }
    }
  }
};

assert.strictEqual(
  vm.runInNewContext(cinnamonReservation, cinnamonContext),
  "docked:2:6202,32,198,1408"
);
assert.deepStrictEqual(
  cinnamonCalls.find((call) => call[0] === "move_resize_frame"),
  ["move_resize_frame", false, 6202, 32, 198, 1408]
);
assert.ok(!cinnamonCalls.some((call) => call[0] === "addChrome"));

// Simulate Electron briefly restoring the old floating height after Cinnamon
// has moved the window. Cinnamon must put it back and see two stable checks
// before it creates the reserved strip.
mockCurrentFrame = { x: 6202, y: 32, width: 198, height: 600 };
const retryCall = cinnamonCalls.find((call) => call[0] === "timeout_add");
assert.strictEqual(retryCall[1], 200);
assert.strictEqual(retryCall[2](), true);
assert.deepStrictEqual(mockCurrentFrame, { x: 6202, y: 32, width: 198, height: 1408 });
assert.ok(!cinnamonCalls.some((call) => call[0] === "addChrome"));
assert.strictEqual(retryCall[2](), true);
assert.strictEqual(retryCall[2](), false);

const addChromeCall = cinnamonCalls.find((call) => call[0] === "addChrome");
assert.deepStrictEqual(addChromeCall[1].position, { x: 6202, y: 32 });
assert.deepStrictEqual(addChromeCall[1].size, { width: 198, height: 1408 });
assert.strictEqual(addChromeCall[2].affectsStruts, true);
const lastMoveIndex = cinnamonCalls.reduce(
  (result, call, index) => call[0] === "move_resize_frame" ? index : result,
  -1
);
const addChromeIndex = cinnamonCalls.findIndex((call) => call[0] === "addChrome");
assert.ok(lastMoveIndex < addChromeIndex);

// Simulate the work-area update displacing the player after the strut appears.
// Because the replacement is a real dock window, the post-strut verification
// can safely put it back inside the reserved strip.
mockCurrentFrame = { x: 6004, y: 32, width: 198, height: 1408 };
const postStrutCall = cinnamonCalls.filter((call) => call[0] === "timeout_add")[1];
assert.strictEqual(postStrutCall[1], 250);
assert.strictEqual(postStrutCall[2](), false);
assert.deepStrictEqual(mockCurrentFrame, { x: 6202, y: 32, width: 198, height: 1408 });

// The liveness watcher also keeps the dock matched if Cinnamon later changes
// monitor work areas or reapplies constraints.
const watcherCall = cinnamonCalls.find((call) => call[0] === "timeout_add_seconds");
assert.strictEqual(watcherCall[1], 1);
mockCurrentFrame = { x: 6004, y: 32, width: 198, height: 1408 };
const moveCountBeforeWatch = cinnamonCalls.filter((call) => call[0] === "move_resize_frame").length;
assert.strictEqual(watcherCall[2](), true);
assert.strictEqual(
  cinnamonCalls.filter((call) => call[0] === "move_resize_frame").length,
  moveCountBeforeWatch + 1
);
assert.deepStrictEqual(mockCurrentFrame, { x: 6202, y: 32, width: 198, height: 1408 });

assert.strictEqual(
  vm.runInNewContext(cinnamonCleanup, cinnamonContext),
  "removed-and-restored"
);
assert.ok(cinnamonCalls.some((call) => (
  call[0] === "move_resize_frame" &&
  call[2] === -620 && call[3] === 40 && call[4] === 198 && call[5] === 600
)));

const indexHtml = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
assert.ok(indexHtml.includes('id="sidebarModeBtn"'));
assert.ok(indexHtml.includes('id="notepadToggleBtn"'));
assert.ok(indexHtml.includes('id="notepadPanel"'));
assert.ok(indexHtml.includes('id="notepadText"'));
assert.ok(indexHtml.includes('id="appVersion"'));
assert.ok(indexHtml.indexOf('id="sidebarModeBtn"') < indexHtml.indexOf('id="openSettingsBtn"'));
assert.ok(indexHtml.indexOf('id="notepadToggleBtn"') < indexHtml.indexOf('id="openSettingsBtn"'));
const stylesSource = fs.readFileSync(path.join(root, "src", "renderer", "styles.css"), "utf8");
assert.ok(stylesSource.includes("flex: 0 0 20vh"));
assert.ok(stylesSource.includes("height: 32px"));
assert.ok(stylesSource.includes(".drag-handle"));
assert.ok(stylesSource.includes(".favorite-row.drop-before"));
assert.ok(stylesSource.includes(".favBtn.no-preroll"));
assert.ok(stylesSource.includes(".station-info"));
assert.ok(stylesSource.includes("column-gap:10px"));
assert.ok(stylesSource.includes("row-gap:0"));
assert.ok(stylesSource.includes(".subgroup-header"));
const preloadSource = fs.readFileSync(path.join(root, "src", "preload.js"), "utf8");
assert.ok(preloadSource.includes('ipcRenderer.invoke("sidebar:toggle")'));
assert.ok(preloadSource.includes('subscribe("player:station-changed"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("notepad:get")'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("notepad:save"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("launcher:get-status"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("launcher:install"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("launcher:remove"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("listening:get"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("listening:reset"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("settings:open", stationId)'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("subgroups:get"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("subgroups:rename"'));
assert.ok(preloadSource.includes('ipcRenderer.invoke("player:play-station", stationId)'));
assert.ok(!preloadSource.includes("showStationContextMenu"));
const settingsHtml = fs.readFileSync(path.join(root, "src", "renderer", "settings.html"), "utf8");
assert.ok(settingsHtml.includes('data-tab="launcher"'));
assert.ok(settingsHtml.includes('id="tab-launcher"'));
assert.ok(settingsHtml.includes('id="installLauncherBtn"'));
assert.ok(settingsHtml.includes('id="removeLauncherBtn"'));
assert.ok(settingsHtml.includes('id="stationEditor"'));
assert.ok(settingsHtml.includes('id="resetListeningBtn"'));
assert.ok(settingsHtml.includes("Listened"));
assert.ok(settingsHtml.includes('id="st_subgroup"'));
assert.ok(settingsHtml.includes('id="st_description"'));
assert.ok(settingsHtml.includes('id="st_no_preroll"'));
const mainSource = fs.readFileSync(path.join(root, "src", "main", "main.js"), "utf8");
assert.ok(!mainSource.includes("loadSidebarState"));
assert.ok(!mainSource.includes("saveSidebarState"));
assert.ok(!mainSource.includes("screen.getCursorScreenPoint()"));
assert.ok(!mainSource.includes("screen.getDisplayNearestPoint"));
assert.ok(mainSource.includes("screen.getPrimaryDisplay()"));
assert.ok(mainSource.includes("screen.getDisplayMatching(mainWindow.getBounds())"));
assert.ok(mainSource.includes("calculateBottomRightBounds"));
assert.ok(mainSource.includes("calculateCenteredBounds"));
assert.ok(!mainSource.includes("calculateSidebarLayout"));
assert.ok(!mainSource.includes("setReservedSpace"));
assert.ok(mainSource.includes('type: sidebar ? "dock" : undefined'));
assert.ok(mainSource.includes("SIDEBAR_NATIVE_TITLE"));
assert.ok(mainSource.includes("dockWindow.waveDeckLoadPromise"));
assert.ok(mainSource.includes("setCinnamonReservedSpace(process.pid, SIDEBAR_NATIVE_TITLE)"));
assert.ok(mainSource.includes("clearCinnamonReservedSpace(process.pid, false, SIDEBAR_NATIVE_TITLE)"));
assert.ok(mainSource.includes("Cinnamon could not apply Sidebar Mode"));
assert.ok(!mainSource.includes("mainWindow.setBounds(layout.bounds)"));
assert.ok(!mainSource.includes("mainWindow.setResizable(false)"));
assert.ok(mainSource.includes("new MediaController"));
assert.ok(mainSource.includes("new MprisService"));
assert.ok(mainSource.includes("new CinnamonMediaKeys"));
assert.ok(mainSource.includes("await mprisService.start()"));
assert.ok(mainSource.includes("await cinnamonMediaKeys.start()"));
assert.ok(mainSource.includes("PLAYBACK_HEARTBEAT_MS = 10_000"));
assert.ok(mainSource.includes("player.refreshPlaybackState()"));
assert.ok(mainSource.includes('ipcMain.handle("notepad:get"'));
assert.ok(mainSource.includes('ipcMain.handle("notepad:save"'));
assert.ok(mainSource.includes('ipcMain.handle("launcher:get-status"'));
assert.ok(mainSource.includes('ipcMain.handle("launcher:install"'));
assert.ok(mainSource.includes('ipcMain.handle("launcher:remove"'));
assert.ok(mainSource.includes('ipcMain.handle("listening:get"'));
assert.ok(mainSource.includes('ipcMain.handle("listening:reset"'));
assert.ok(mainSource.includes('ipcMain.handle("subgroups:get"'));
assert.ok(mainSource.includes('ipcMain.handle("subgroups:rename"'));
assert.ok(mainSource.includes('ipcMain.handle("player:play-station"'));
assert.ok(!mainSource.includes('ipcMain.on("stations:show-context-menu"'));
const desktopLauncherSource = fs.readFileSync(path.join(root, "src", "main", "desktop-launcher.js"), "utf8");
assert.ok(desktopLauncherSource.includes('.local", "share", "applications"'));
assert.ok(desktopLauncherSource.includes("X-WaveDeck-Managed=true"));
const rendererSource = fs.readFileSync(path.join(root, "src", "renderer", "renderer.js"), "utf8");
assert.ok(rendererSource.includes("saveFavoriteOrder"));
assert.ok(rendererSource.includes('handle.draggable = true'));
assert.ok(rendererSource.includes("normalizeFavoriteOrder"));
assert.ok(rendererSource.includes('createSectionTitle("Most Played")'));
assert.ok(rendererSource.includes("const MOST_LISTENED_MINIMUM_SECONDS = 5 * 60"));
assert.ok(rendererSource.includes("onListeningHistoryChanged"));
assert.ok(rendererSource.includes("if (sidebarModeEnabled) queueRender()"));
assert.ok(rendererSource.includes("event.shiftKey"));
assert.ok(rendererSource.includes("editStation(row.dataset.id)"));
assert.ok(rendererSource.includes("Detecting bitrate"));
assert.ok(rendererSource.includes("createSubgroupBlock"));
assert.ok(rendererSource.includes("playStation(row.dataset.id)"));
assert.ok(rendererSource.includes("currentStationId"));
const settingsSource = fs.readFileSync(path.join(root, "src", "renderer", "settings.js"), "utf8");
assert.ok(settingsSource.includes("addSubgroup"));
assert.ok(settingsSource.includes("renameSubgroup"));
assert.ok(settingsSource.includes("moveSubgroup"));
assert.ok(settingsSource.includes("deleteSubgroup"));

for (const file of [
  "src/main/main.js",
  "src/main/data-migration.js",
  "src/main/desktop-launcher.js",
  "src/main/player.js",
  "src/main/portable-paths.js",
  "src/main/storage.js",
  "src/main/stream-probe.js",
  "src/main/sidebar.js",
  "src/main/cinnamon-reservation.js",
  "src/main/cinnamon-media-keys.js",
  "src/main/media-controller.js",
  "src/main/listening-history.js",
  "src/main/mpris.js",
  "src/main/window-layout.js",
  "src/preload.js",
  "src/renderer/renderer.js",
  "src/renderer/settings.js"
]) {
  new Function(fs.readFileSync(path.join(root, file), "utf8"));
}

async function validateMediaControls() {
  const heartbeatEvents = [];
  const heartbeatPlayer = new MpvPlayer({
    executable: "mpv",
    ipcPath: "/tmp/wavedeck-heartbeat-test.sock",
    platform: "linux",
    onStatus: (status) => heartbeatEvents.push(status)
  });
  heartbeatPlayer.socket = { destroyed: false };
  heartbeatPlayer.command = async (command) => {
    assert.deepStrictEqual(command, ["get_property", "idle-active"]);
    return { data: false };
  };
  await heartbeatPlayer.refreshPlaybackState();
  assert.strictEqual(heartbeatPlayer.getStatus().playing, true);
  assert.strictEqual(heartbeatPlayer.getStatus().state, "playing");
  assert.strictEqual(heartbeatEvents.length, 1);

  const stationList = [
    { id: "beta-alias", name: "Beta Alias", url: "https://example.com/beta", favorite: false },
    { id: "beta", name: "Beta", url: "https://example.com/beta", favorite: true, favoriteOrder: 0 },
    { id: "other", name: "Other", url: "https://example.com/other", favorite: false },
    { id: "alpha", name: "Alpha", url: "https://example.com/alpha", favorite: true, favoriteOrder: 1 }
  ];
  let missingEventTime = 0;
  const missingEventHistory = new ListeningHistory({
    storage: {
      readListeningHistory: () => ({ version: 1, stations: {} }),
      writeListeningHistory: (history) => history
    },
    now: () => missingEventTime,
    setTimer: () => 1,
    clearTimer: () => {}
  });
  const missingEventPlayer = {
    getStatus: () => ({ state: "ready", playing: false }),
    play: async () => true,
    stop: async () => true
  };
  const missingEventController = new MediaController({
    player: missingEventPlayer,
    getStations: () => [{
      id: "st_mtjk2dw5_kn5p33sb",
      name: "IndieXL",
      url: "https://server-23.stream-server.nl:18438/"
    }],
    onStateChanged: (status) => missingEventHistory.handleStatus(status)
  });
  await missingEventController.playStationById("st_mtjk2dw5_kn5p33sb");
  missingEventTime = 50 * 60 * 1000;
  assert.strictEqual(
    missingEventHistory.getStats().stations.st_mtjk2dw5_kn5p33sb.seconds,
    3000
  );
  await missingEventController.stop();
  missingEventHistory.close();

  const calls = [];
  const fakePlayer = {
    status: { state: "ready", message: "Playback engine is ready.", playing: false, volume: 80 },
    getStatus() { return { ...this.status }; },
    async play(url) {
      calls.push(["play", url]);
      this.status = { ...this.status, state: "playing", playing: true };
      return true;
    },
    async stop() {
      calls.push(["stop"]);
      this.status = { ...this.status, state: "ready", playing: false };
      return true;
    },
    async setVolume(value) {
      calls.push(["volume", value]);
      this.status = { ...this.status, volume: value };
      return value;
    }
  };
  const stationEvents = [];
  const stateEvents = [];
  const controller = new MediaController({
    player: fakePlayer,
    getStations: () => stationList,
    onStationChanged: (station) => stationEvents.push(station),
    onStateChanged: (status) => stateEvents.push(status.mediaState)
  });
  assert.deepStrictEqual(controller.getFavorites().map((station) => station.name), ["Beta", "Alpha"]);
  assert.strictEqual(await controller.togglePlayPause(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  assert.strictEqual(await controller.nextFavorite(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  assert.strictEqual(await controller.nextFavorite(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  assert.strictEqual(await controller.previousFavorite(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  assert.strictEqual(await controller.pause(), true);
  assert.strictEqual(controller.getMediaState(), "paused");
  assert.strictEqual(await controller.togglePlayPause(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  await controller.playUrl("https://example.com/other");
  assert.strictEqual(await controller.nextFavorite(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  await controller.playUrl("https://example.com/other");
  assert.strictEqual(await controller.previousFavorite(), true);
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  assert.strictEqual(await controller.stop(), true);
  assert.strictEqual(controller.getMediaState(), "stopped");
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  assert.strictEqual(await controller.setVolume(0.42), 0.42);
  assert.deepStrictEqual(calls.at(-1), ["volume", 42]);
  await controller.playStationById("beta");
  assert.strictEqual(controller.getCurrentStation().id, "beta");
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  await controller.playStationById("beta-alias");
  assert.strictEqual(controller.getCurrentStation().id, "beta-alias");
  assert.strictEqual(controller.getCurrentStation().name, "Beta Alias");
  await controller.playStationById("alpha");
  await controller.stop();
  assert.ok(stationEvents.length >= 7);
  assert.ok(stateEvents.includes("paused"));

  assert.strictEqual(stationTrackPath({ id: "alpha-one" }), "/com/a17press/wavedeck/station/alpha_one");
  const metadata = metadataForStation(controller.getCurrentStation());
  assert.strictEqual(metadata["xesam:title"].value, "Alpha");
  assert.strictEqual(metadata["xesam:artist"].value[0], "WaveDeck");

  const mpris = new MprisPlayerInterface({ controller });
  const introspection = mpris.$introspect();
  const methodNames = introspection.method.map((method) => method.$.name);
  assert.ok(methodNames.includes("PlayPause"));
  assert.ok(methodNames.includes("Next"));
  assert.ok(methodNames.includes("Previous"));
  mpris.update(controller.getStatus(), controller.getCurrentStation(), controller.getFavorites().length);
  assert.strictEqual(mpris.PlaybackStatus, "Stopped");
  assert.strictEqual(mpris.CanGoNext, true);
  await mpris.Play();
  assert.strictEqual(controller.getMediaState(), "playing");
  await mpris.Next();
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  await mpris.Previous();
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  await mpris.PlayPause();
  assert.strictEqual(controller.getMediaState(), "paused");

  class MockMediaKeysInterface extends EventEmitter {
    constructor() {
      super();
      this.grabs = [];
      this.releases = [];
    }

    async GrabMediaPlayerKeys(application, time) {
      this.grabs.push([application, time]);
    }

    async ReleaseMediaPlayerKeys(application) {
      this.releases.push(application);
    }
  }

  const mockMediaKeys = new MockMediaKeysInterface();
  let disconnectCount = 0;
  const mockBus = {
    async getProxyObject(serviceName, objectPath) {
      assert.strictEqual(serviceName, SERVICE_NAME);
      assert.strictEqual(objectPath, CINNAMON_MEDIA_KEYS_PATH);
      return {
        getInterface(interfaceName) {
          assert.strictEqual(interfaceName, INTERFACE_NAME);
          return mockMediaKeys;
        }
      };
    },
    disconnect() { disconnectCount += 1; }
  };
  const cinnamonMediaKeys = new CinnamonMediaKeys({
    platform: "linux",
    applicationName: "WaveDeck-test",
    busFactory: () => mockBus,
    controller
  });

  assert.strictEqual(await cinnamonMediaKeys.start(), true);
  assert.deepStrictEqual(mockMediaKeys.grabs, [["WaveDeck-test", 0]]);
  mockMediaKeys.emit("MediaPlayerKeyPressed", "Some Other Player", "Next");
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  mockMediaKeys.emit("MediaPlayerKeyPressed", "WaveDeck-test", "Previous");
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(controller.getCurrentStation().name, "Alpha");
  await mpris.Next();
  assert.strictEqual(controller.getCurrentStation().name, "Beta");
  await cinnamonMediaKeys.claim();
  assert.strictEqual(mockMediaKeys.grabs.length, 2);
  cinnamonMediaKeys.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(mockMediaKeys.releases, ["WaveDeck-test"]);
  assert.strictEqual(disconnectCount, 1);
}

validateMediaControls().then(() => {
console.log("WaveDeck validation passed: v0.2.2 IndieXL-style listening fallback, mpv heartbeat, compact station details, ID-based playback, live Most Played refresh, Shift-click editing, subgroups, no-pre-roll markers, bitrate detection, launch layout, notepad, Sidebar Mode, favorite order, MPRIS, Cinnamon media keys, and panel launcher verified.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
