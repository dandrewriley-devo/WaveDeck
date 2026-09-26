const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, screen, shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { MpvPlayer, getIpcPath, getMpvExecutable } = require("./player");
const { MediaController, serializeTransport } = require("./media-controller");
const {
  StreamRecorder,
  prepareFfprobeExecutable,
  prepareFfmpegExecutable,
  resolveFfprobeExecutable,
  resolveFfmpegExecutable,
  verifyFfmpegExecutable
} = require("./recorder");
const { ListeningHistory } = require("./listening-history");
const { createLibraryUpdater, nodeHttpsFetch } = require("./library-updater");
const { copyLegacyData } = require("./data-migration");
const { RecordingLibrary } = require("./recording-library");
const { MusicLibrary } = require('./music-library');
const { MusicRadio } = require('./music-radio');
const { LastFmEnricher } = require('./lastfm-enricher');
const {
  getLauncherStatus,
  installLauncher,
  removeLauncher
} = require("./desktop-launcher");
const {
  resolveDataDir,
  resolveLegacyDataDirs,
  resolvePortableState,
  resolveRuntimeDir
} = require("./portable-paths");
const { PortableStorage } = require("./storage");
const { probeStream } = require("./stream-probe");
const {
  clearCinnamonReservedSpace,
  setCinnamonReservedSpace
} = require("./cinnamon-reservation");
const {
  SIDEBAR_WIDTH,
  sidebarAvailability
} = require("./sidebar");
const {
  calculateBottomRightBounds,
  calculateCenteredBounds,
  constrainBoundsToDisplay
} = require("./window-layout");
const {
  WindowsSidebar,
  calculateWindowsSidebarBounds,
  resolveWindowsSidebarHelper
} = require("./windows-sidebar");

let MprisService = null;
let PlatformMediaKeys = null;
if (process.platform === "linux") {
  ({ MprisService } = require("./mpris"));
  ({ CinnamonMediaKeys: PlatformMediaKeys } = require("./cinnamon-media-keys"));
} else if (process.platform === "win32") {
  ({ WindowsMediaKeys: PlatformMediaKeys } = require("./windows-media-keys"));
} else if (process.platform === "darwin") {
  ({ WindowsMediaKeys: PlatformMediaKeys } = require("./windows-media-keys"));
}

const FIXED_WIDTH = SIDEBAR_WIDTH;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const FLOATING_NATIVE_TITLE = "WaveDeck";
const SIDEBAR_NATIVE_TITLE = "WaveDeck Sidebar";
const SIDEBAR_REALIZE_DELAY_MS = 150;
const MEDIA_KEY_RECLAIM_INTERVAL_MS = 15_000;
const PLAYBACK_HEARTBEAT_MS = 10_000;
const SETTINGS_DEFAULT_WIDTH = 1100;
const SETTINGS_DEFAULT_HEIGHT = 800;
const SETTINGS_MIN_WIDTH = 700;
const SETTINGS_MIN_HEIGHT = 500;
const RADIO_LOG_DEFAULT_WIDTH = 860;
const RADIO_LOG_DEFAULT_HEIGHT = 700;
const RADIO_LOG_MIN_WIDTH = 560;
const RADIO_LOG_MIN_HEIGHT = 400;
const RADIO_LOG_SHORTCUT = "CommandOrControl+Alt+Shift+L";
const LASTFM_REFRESH_SHORTCUT = "CommandOrControl+Alt+Shift+F";
const DISPLAY_VERSION = require("../../package.json").wavedeckVersion || app.getVersion();

let mainWindow = null;
let settingsWindow = null;
let radioLogWindow = null;
const radioDiagnosticSession = [];
const RADIO_DIAGNOSTIC_LIMIT = 3000;
let storage = null;
let player = null;
let recordingLibrary = null;
let musicLibrary = null;
let musicRadio = null;
let lastFmEnricher = null;
let recordingProbeExecutable = "";
let mediaController = null;
let recorder = null;
let mprisService = null;
let platformMediaKeys = null;
let listeningHistory = null;
let playbackHeartbeat = null;
let mediaKeyReclaimTimer = null;
let mediaKeyReclaimEnabled = false;
let mediaKeyReclaimPaused = false;
let libraryUpdater = null;
let libraryUpdateTimer = null;
let windowsSidebar = null;
let sidebarApplied = false;
let sidebarTransitioning = false;
let floatingBounds = null;
let sectionVisibility = { presets: false, favoritesOnly: false, mostPlayed: false, collapsedGroups: [], collapsedSubgroups: [] };
let quitFinalizingRecording = false;
let cleanupComplete = false;
const startupWarnings = [];

function getDataDir() {
  return resolveDataDir({
    envDataDir: process.env.WAVEDECK_DATA_DIR || process.env.WAVEDECKSB_DATA_DIR,
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    execPath: process.execPath,
    projectRoot: PROJECT_ROOT,
    homeDir: os.homedir()
  });
}

function getLegacyDataDirs() {
  return resolveLegacyDataDirs({
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE,
    homeDir: os.homedir()
  });
}

function isPortableBuild() {
  return resolvePortableState({
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE
  });
}

function configurePortableRuntimePaths() {
  if (!process.env.WAVEDECK_DATA_DIR && !process.env.WAVEDECKSB_DATA_DIR) {
    try {
      const migration = copyLegacyData({ legacyDirs: getLegacyDataDirs(), targetDir: getDataDir() });
      if (migration.copied.length) {
        startupWarnings.push("Your existing WaveDeck data was copied into the new Data folder. The original folder was left untouched as a backup.");
      }
    } catch (error) {
      startupWarnings.push(`WaveDeck could not copy the previous WaveDeckSB data automatically: ${error.message}`);
    }
  }
  if (!isPortableBuild()) return;
  const runtimeDir = getRuntimeDir();
  fs.mkdirSync(runtimeDir, { recursive: true });
  app.setPath("userData", runtimeDir);
  app.setPath("sessionData", runtimeDir);
}

function getRuntimeDir() {
  return resolveRuntimeDir({
    platform: process.platform,
    appDataDir: app.getPath("appData")
  });
}

function getDefaultsDir() {
  return path.join(app.getAppPath(), "defaults");
}

function getRecordingsDir() {
  return path.join(path.dirname(getDataDir()), "Recordings");
}

function getDesktopLauncherState() {
  const appImagePath = process.platform === "linux" && app.isPackaged && process.env.APPIMAGE
    ? path.resolve(process.env.APPIMAGE)
    : "";
  const status = getLauncherStatus({ homeDir: os.homedir(), appImagePath });
  return {
    available: Boolean(appImagePath),
    installed: status.installed,
    managed: status.managed,
    current: status.current
  };
}

function refreshApplicationsMenu() {
  const iconThemeDir = path.join(os.homedir(), ".local", "share", "icons", "hicolor");
  const applicationsDir = path.join(os.homedir(), ".local", "share", "applications");
  execFile("update-desktop-database", [applicationsDir], { timeout: 4000 }, () => {});
  execFile("gtk-update-icon-cache", ["-f", "-t", iconThemeDir], { timeout: 4000 }, () => {});
}

function sendToMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function sendToAll(channel, payload) {
  sendToMain(channel, payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(channel, payload);
  }
}

function sendToRadioLog(decision) {
  if (decision?.selected) {
    radioDiagnosticSession.push(decision);
    if (radioDiagnosticSession.length > RADIO_DIAGNOSTIC_LIMIT) radioDiagnosticSession.shift();
  }
  if (radioLogWindow && !radioLogWindow.isDestroyed()) {
    radioLogWindow.webContents.send("music:debug-decision", decision);
  }
}

function sendLastFmStatus(status) { sendToAll('music:lastfm-changed', status); }

function broadcastPlayerStatus(status = player?.getStatus()) {
  const combinedStatus = mediaController ? mediaController.getStatus(status) : status;
  listeningHistory?.handleStatus(combinedStatus);
  sendToMain("player:status-changed", combinedStatus);
  mprisService?.update(combinedStatus);
  return combinedStatus;
}

function broadcastStationChanged(station) {
  sendToMain("player:station-changed", station);
  mprisService?.update(mediaController?.getStatus());
  reclaimMediaKeys();
}

function broadcastRecordingState(state = recorder?.getState()) {
  if (state) sendToMain("recording:state-changed", state);
  if (state?.lastFileName && !state.active && !state.finalizing) sendToMain("recordings:changed");
  return state;
}

function reclaimMediaKeys() {
  if (!mediaKeyReclaimEnabled || mediaKeyReclaimPaused) return;
  void platformMediaKeys?.claim({ reconnect: true }).catch((error) => {
    console.warn(`Could not reclaim media keys: ${error.message}`);
  });
}

function startMediaKeyReclaim() {
  if (mediaKeyReclaimTimer) clearInterval(mediaKeyReclaimTimer);
  mediaKeyReclaimTimer = setInterval(reclaimMediaKeys, MEDIA_KEY_RECLAIM_INTERVAL_MS);
  mediaKeyReclaimTimer.unref?.();
}

function startPlaybackHeartbeat() {
  if (playbackHeartbeat) clearInterval(playbackHeartbeat);
  playbackHeartbeat = setInterval(() => {
    if (!player || mediaController?.getMediaState() !== "playing") return;
    void player.refreshPlaybackState().catch(() => {});
  }, PLAYBACK_HEARTBEAT_MS);
  playbackHeartbeat.unref?.();
}

function scheduleLibraryUpdateCheck(delayMs = 1_500) {
  if (!libraryUpdater) return;
  if (libraryUpdateTimer) clearTimeout(libraryUpdateTimer);
  libraryUpdateTimer = setTimeout(() => {
    libraryUpdateTimer = null;
    void libraryUpdater.check();
  }, delayMs);
  libraryUpdateTimer.unref?.();
}

function createSecureWindow(options, { showOnReady = true } = {}) {
  const window = new BrowserWindow({
    ...options,
    icon: path.join(PROJECT_ROOT, "build", "icon.png"),
    show: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("focus", () => {
    reclaimMediaKeys();
  });
  if (showOnReady) window.once("ready-to-show", () => window.show());
  return window;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createMainWindow({
  sidebar = false,
  bounds = null,
  showOnReady = true,
  makeCurrent = true
} = {}) {
  const nativeTitle = sidebar ? SIDEBAR_NATIVE_TITLE : FLOATING_NATIVE_TITLE;
  const geometry = bounds ? {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  } : calculateBottomRightBounds(screen.getPrimaryDisplay(), FIXED_WIDTH, 600);
  const window = createSecureWindow({
    ...geometry,
    minWidth: FIXED_WIDTH,
    maxWidth: FIXED_WIDTH,
    minHeight: 400,
    resizable: true,
    skipTaskbar: sidebar,
    title: nativeTitle,
    type: sidebar && process.platform === "linux" ? "dock" : undefined
  }, { showOnReady });

  window.setTitle(nativeTitle);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(nativeTitle);
  });

  const rememberFloatingBounds = () => {
    if (sidebar || sidebarApplied || mainWindow !== window) return;
    if (!window.isDestroyed()) floatingBounds = window.getBounds();
  };

  window.on("move", rememberFloatingBounds);
  window.on("resize", rememberFloatingBounds);

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  window.waveDeckLoadPromise = window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  if (makeCurrent) mainWindow = window;
  return window;
}

function openSettingsWindow(stationId = "") {
  const requestedStationId = String(stationId ?? "").trim();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    if (requestedStationId) {
      settingsWindow.webContents.send("settings:edit-station", requestedStationId);
    }
    return;
  }

  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const remembersWindowGeometry = process.platform === "linux" || process.platform === "win32";
  let geometry = calculateCenteredBounds(
    display,
    remembersWindowGeometry ? SETTINGS_DEFAULT_WIDTH : 860,
    remembersWindowGeometry ? SETTINGS_DEFAULT_HEIGHT : 620
  );
  if (remembersWindowGeometry) {
    const savedBounds = storage.getUiPreferences().settingsWindowBounds;
    const targetDisplay = savedBounds ? screen.getDisplayMatching(savedBounds) : display;
    geometry = constrainBoundsToDisplay(targetDisplay, savedBounds || geometry, {
      minWidth: SETTINGS_MIN_WIDTH,
      minHeight: SETTINGS_MIN_HEIGHT
    });
  }
  settingsWindow = createSecureWindow({
    ...geometry,
    minWidth: Math.min(SETTINGS_MIN_WIDTH, geometry.width),
    minHeight: Math.min(SETTINGS_MIN_HEIGHT, geometry.height),
    resizable: true,
    title: "WaveDeck Settings"
  });

  settingsWindow.on("close", () => {
    if (!remembersWindowGeometry || !settingsWindow || settingsWindow.isDestroyed()) return;
    try {
      const bounds = settingsWindow.isMaximized()
        ? settingsWindow.getNormalBounds()
        : settingsWindow.getBounds();
      storage.setSettingsWindowBounds(bounds);
    } catch (error) {
      console.warn(`Could not remember the Settings window position: ${error.message}`);
    }
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
    scheduleLibraryUpdateCheck(0);
  });

  if (requestedStationId) {
    settingsWindow.webContents.once("did-finish-load", () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send("settings:edit-station", requestedStationId);
      }
    });
  }
  settingsWindow.loadFile(path.join(__dirname, "..", "renderer", "settings.html"));
}

function openRadioLogWindow() {
  if (radioLogWindow && !radioLogWindow.isDestroyed()) {
    radioLogWindow.show();
    radioLogWindow.focus();
    return;
  }
  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const savedBounds = storage.getUiPreferences().radioLogWindowBounds;
  const targetDisplay = savedBounds ? screen.getDisplayMatching(savedBounds) : display;
  const geometry = constrainBoundsToDisplay(targetDisplay, savedBounds || calculateCenteredBounds(
    display, RADIO_LOG_DEFAULT_WIDTH, RADIO_LOG_DEFAULT_HEIGHT
  ), { minWidth: RADIO_LOG_MIN_WIDTH, minHeight: RADIO_LOG_MIN_HEIGHT });
  radioLogWindow = createSecureWindow({
    ...geometry,
    minWidth: Math.min(RADIO_LOG_MIN_WIDTH, geometry.width),
    minHeight: Math.min(RADIO_LOG_MIN_HEIGHT, geometry.height),
    resizable: true,
    title: "WaveDeck Live Radio Log"
  });
  radioLogWindow.on("close", () => {
    if (!radioLogWindow || radioLogWindow.isDestroyed()) return;
    try {
      const bounds = radioLogWindow.isMaximized()
        ? radioLogWindow.getNormalBounds()
        : radioLogWindow.getBounds();
      storage.setRadioLogWindowBounds(bounds);
    } catch (error) {
      console.warn(`Could not remember the Live Radio Log position: ${error.message}`);
    }
  });
  radioLogWindow.on("closed", () => { radioLogWindow = null; });
  radioLogWindow.loadFile(path.join(__dirname, "..", "renderer", "radio-log.html"));
}

function getSidebarState() {
  const availability = sidebarAvailability({
    windowsHelperAvailable: process.platform === "win32" && windowsSidebar?.isAvailable() === true
  });
  return {
    ...availability,
    enabled: availability.available && sidebarApplied
  };
}

async function setSidebarMode(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The WaveDeck window is unavailable.");
  if (sidebarTransitioning) return getSidebarState();
  sidebarTransitioning = true;
  mediaKeyReclaimPaused = true;

  try {
    if (process.platform === "win32") {
      const availability = sidebarAvailability({
        windowsHelperAvailable: windowsSidebar?.isAvailable() === true
      });
      if (!availability.available) throw new Error(availability.reason);

      if (enabled) {
        if (sidebarApplied) return getSidebarState();
        floatingBounds = mainWindow.getBounds();
        const windowsDockBounds = calculateWindowsSidebarBounds(
          screen.getDisplayMatching(floatingBounds),
          FIXED_WIDTH
        );
        sidebarApplied = true;
        try {
          mainWindow.setAlwaysOnTop(true);
          mainWindow.setSkipTaskbar(true);
          mainWindow.setBounds(windowsDockBounds, false);
          await windowsSidebar.apply(mainWindow, FIXED_WIDTH);
          // Keep Electron's DPI-aware window geometry authoritative. The
          // native AppBar owns the desktop reservation, but some Windows
          // configurations do not resize the Electron window to its height.
          mainWindow.setBounds(windowsDockBounds, false);
          mainWindow.setResizable(false);
          mainWindow.setMovable(false);
          mainWindow.setMinimizable(false);
          mainWindow.setMaximizable(false);
          mainWindow.show();
          mainWindow.moveTop();
        } catch (error) {
          await windowsSidebar?.remove();
          sidebarApplied = false;
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setSkipTaskbar(false);
          mainWindow.setResizable(true);
          mainWindow.setMovable(true);
          mainWindow.setMinimizable(true);
          mainWindow.setMaximizable(true);
          if (floatingBounds) mainWindow.setBounds(floatingBounds);
          throw new Error(`Windows could not apply Sidebar Mode. ${error.message}`);
        }
      } else {
        if (!sidebarApplied) return getSidebarState();
        await windowsSidebar.remove();
        sidebarApplied = false;
        mainWindow.setAlwaysOnTop(false);
        mainWindow.setSkipTaskbar(false);
        mainWindow.setResizable(true);
        mainWindow.setMovable(true);
        mainWindow.setMinimizable(true);
        mainWindow.setMaximizable(true);
        if (floatingBounds) {
          const display = screen.getDisplayMatching(floatingBounds);
          mainWindow.setBounds(constrainBoundsToDisplay(display, floatingBounds, {
            minWidth: FIXED_WIDTH,
            minHeight: 400
          }));
        }
        mainWindow.show();
        mainWindow.focus();
      }

      const state = getSidebarState();
      sendToMain("sidebar:state-changed", state);
      return state;
    }

    if (enabled) {
      const availability = sidebarAvailability();
      if (!availability.available) throw new Error(availability.reason);
      if (sidebarApplied) return getSidebarState();

      const floatingWindow = mainWindow;
      floatingBounds = floatingWindow.getBounds();
      sidebarApplied = true;
      let dockWindow = null;

      try {
        // Linux window type is immutable after construction. Build a hidden
        // _NET_WM_WINDOW_TYPE_DOCK replacement, let X11 realize it, then ask
        // Cinnamon to position it and reserve the identical rectangle.
        dockWindow = createMainWindow({
          sidebar: true,
          bounds: floatingBounds,
          showOnReady: false,
          makeCurrent: false
        });
        await dockWindow.waveDeckLoadPromise;
        dockWindow.setAlwaysOnTop(true);
        try { dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }); } catch {}
        try { dockWindow.setOpacity(0); } catch {}
        dockWindow.showInactive();
        await delay(SIDEBAR_REALIZE_DELAY_MS);
        await setCinnamonReservedSpace(process.pid, SIDEBAR_NATIVE_TITLE);

        mainWindow = dockWindow;
        try { dockWindow.setOpacity(1); } catch {}
        dockWindow.show();
        dockWindow.moveTop();
        floatingWindow.destroy();
      } catch (error) {
        try {
          await clearCinnamonReservedSpace(process.pid, false, SIDEBAR_NATIVE_TITLE);
        } catch {}
        if (dockWindow && !dockWindow.isDestroyed()) dockWindow.destroy();
        sidebarApplied = false;
        mainWindow = floatingWindow;
        floatingWindow.show();
        const state = getSidebarState();
        sendToMain("sidebar:state-changed", state);
        throw new Error(`Cinnamon could not apply Sidebar Mode. ${error.message}`);
      }
    } else {
      if (!sidebarApplied) return getSidebarState();

      const dockWindow = mainWindow;
      sidebarApplied = false;
      let floatingWindow = null;
      try {
        floatingWindow = createMainWindow({
          sidebar: false,
          bounds: floatingBounds,
          showOnReady: false,
          makeCurrent: false
        });
        await floatingWindow.waveDeckLoadPromise;
        await clearCinnamonReservedSpace(process.pid, false, SIDEBAR_NATIVE_TITLE);
        mainWindow = floatingWindow;
        floatingWindow.show();
        floatingWindow.focus();
        dockWindow.destroy();
      } catch (error) {
        if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();
        sidebarApplied = true;
        mainWindow = dockWindow;
        startupWarnings.push(`Could not immediately release Sidebar Mode space: ${error.message}`);
        throw error;
      }
    }

    const state = getSidebarState();
    sendToMain("sidebar:state-changed", state);
    return state;
  } finally {
    sidebarTransitioning = false;
    mediaKeyReclaimPaused = false;
    reclaimMediaKeys();
  }
}

function installIpcHandlers() {
  ipcMain.handle("stations:get", () => storage.readStations());
  ipcMain.handle("stations:save", (_event, stations) => {
    const saved = storage.writeStations(stations);
    storage.syncGroupsWithStations(saved);
    storage.syncSubgroupsWithStations(saved);
    sendToAll("stations:changed");
    sendToAll("groups:changed");
    sendToAll("subgroups:changed");
    mprisService?.update();
    return saved;
  });
  ipcMain.handle("stations:delete", (_event, stationId) => {
    const result = storage.deleteStation(stationId);
    if (result.ok) {
      sendToAll("stations:changed");
      mprisService?.update();
    }
    return result;
  });
  ipcMain.handle("stations:set-gain", async (_event, stationId, value) => {
    const gainDb = storage.setStationGain(stationId, value);
    const applied = await mediaController.setStationGain(stationId, gainDb);
    return { gainDb, applied };
  });

  ipcMain.handle("groups:get", () => storage.readGroups());
  ipcMain.handle("groups:save", (_event, groups) => {
    const saved = storage.writeGroups(groups);
    sendToAll("groups:changed");
    return saved;
  });

  ipcMain.handle("groups:remove", (_event, groupName) => {
    const result = storage.removeGroup(groupName);
    if (result.ok) {
      sendToAll("groups:changed");
      sendToAll("subgroups:changed");
      sendToAll("stations:changed");
    }
    return result;
  });

  ipcMain.handle("subgroups:get", () => storage.readSubgroups());
  ipcMain.handle("subgroups:save", (_event, subgroups) => {
    const saved = storage.saveSubgroups(subgroups);
    sendToAll("subgroups:changed");
    return saved;
  });
  ipcMain.handle("subgroups:rename", (_event, groupName, oldName, newName) => {
    const result = storage.renameSubgroup(groupName, oldName, newName);
    if (result.ok) {
      sendToAll("subgroups:changed");
      sendToAll("stations:changed");
    }
    return result;
  });
  ipcMain.handle("subgroups:remove", (_event, groupName, subgroupName) => {
    const result = storage.removeSubgroup(groupName, subgroupName);
    if (result.ok) {
      sendToAll("subgroups:changed");
      sendToAll("stations:changed");
    }
    return result;
  });

  ipcMain.handle("library:export", async () => {
    const library = storage.exportLibrary();
    const result = await dialog.showSaveDialog(settingsWindow || mainWindow, {
      title: "Export WaveDeck library",
      defaultPath: path.join(app.getPath("documents"), "WaveDeck_Library.json"),
      filters: [{ name: "JSON files", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, `${JSON.stringify(library, null, 2)}\n`, "utf8");
    return { canceled: false, filePath: result.filePath, count: library.stations.length };
  });

  ipcMain.handle("library:import", async (_event, mode) => {
    if (mode !== "add" && mode !== "replace") throw new Error("Unknown library import mode.");
    const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      title: mode === "replace" ? "Replace WaveDeck library" : "Add new items to WaveDeck library",
      properties: ["openFile"],
      filters: [{ name: "JSON files", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

    const importPath = result.filePaths[0];
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(importPath, "utf8"));
    } catch {
      throw new Error("The selected file is not valid JSON.");
    }

    const imported = storage.importLibrary(parsed, { mode });
    sendToAll("stations:changed");
    sendToAll("groups:changed");
    sendToAll("subgroups:changed");
    mprisService?.update();
    return { canceled: false, filePath: importPath, ...imported };
  });

  ipcMain.handle("library-update:get-state", () => storage.getLibraryUpdateState());
  ipcMain.handle("library-update:set-enabled", (_event, enabled) => {
    const state = storage.setLibraryUpdatesEnabled(enabled);
    if (state.enabled) scheduleLibraryUpdateCheck(0);
    return state;
  });

  ipcMain.handle("stream:test", (_event, url) => probeStream(url));

  ipcMain.handle("listening:get", () => listeningHistory.getStats());
  ipcMain.handle("listening:reset", () => listeningHistory.reset());
  ipcMain.handle("sections:get-state", () => ({
    ...sectionVisibility,
    collapsedGroups: [...sectionVisibility.collapsedGroups],
    collapsedSubgroups: [...sectionVisibility.collapsedSubgroups]
  }));
  ipcMain.handle("sections:set-state", (_event, state = {}) => {
    sectionVisibility = storage.setStreamingUiState({ ...sectionVisibility, ...state });
    sendToAll("sections:state-changed", { ...sectionVisibility });
    return { ...sectionVisibility };
  });

  ipcMain.handle("launcher:get-status", () => getDesktopLauncherState());
  ipcMain.handle("launcher:install", () => {
    if (process.platform !== "linux" || !app.isPackaged || !process.env.APPIMAGE) {
      throw new Error("Application launcher setup is only available from the portable Linux AppImage.");
    }
    installLauncher({
      homeDir: os.homedir(),
      appImagePath: path.resolve(process.env.APPIMAGE),
      iconSourcePath: path.join(app.getAppPath(), "build", "icon.png"),
      version: app.getVersion()
    });
    refreshApplicationsMenu();
    return getDesktopLauncherState();
  });
  ipcMain.handle("launcher:remove", () => {
    if (process.platform !== "linux") throw new Error("Application launchers are only available on Linux.");
    removeLauncher({
      homeDir: os.homedir(),
      appImagePath: process.env.APPIMAGE ? path.resolve(process.env.APPIMAGE) : ""
    });
    refreshApplicationsMenu();
    return getDesktopLauncherState();
  });

  ipcMain.handle("ui:get-preferences", () => storage.getUiPreferences());
  ipcMain.handle("ui:set-launch-in-sidebar", (_event, enabled) => {
    if (process.platform !== "linux" && process.platform !== "win32") {
      throw new Error("Sidebar launch is not available on this operating system.");
    }
    return storage.setLaunchInSidebarMode(enabled);
  });
  ipcMain.handle("ui:set-pro-mode", async (_event, enabled) => {
    if (!enabled && recorder?.isRecording()) {
      throw new Error("Stop the current recording before turning Advanced Features off.");
    }
    const preferences = storage.setProModeEnabled(enabled);
    if (!preferences.proModeEnabled) {
      if (mediaController?.music) await mediaController.stop();
      musicLibrary?.disable();
      sectionVisibility = storage.setStreamingUiState({
        ...sectionVisibility,
        favoritesOnly: false,
        mostPlayed: false
      });
      sendToAll("sections:state-changed", { ...sectionVisibility });
    }
    if (preferences.proModeEnabled) void musicLibrary.enable({ scanOnEnable: true }).then(() => lastFmEnricher?.configure()).catch(error => sendToMain('app:warning', error.message));
    sendToAll("ui:preferences-changed", preferences);
    return preferences;
  });
  ipcMain.handle('ui:choose-additional-music-folder', async () => {
    const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      title: 'Choose Additional Music Folder', properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? '' : (result.filePaths[0] || '');
  });
  ipcMain.handle('ui:set-additional-music-folder', async (_event, folder) => {
    const selected = String(folder || '').trim();
    if (selected) {
      const stat = await fs.promises.stat(selected);
      if (!stat.isDirectory()) throw new Error('Choose a folder containing MP3 files.');
    }
    const preferences = storage.setAdditionalMusicFolder(selected);
    await musicLibrary?.setAdditionalMusicFolder(preferences.additionalMusicFolder);
    sendToAll('ui:preferences-changed', preferences);
    return preferences;
  });
  ipcMain.handle('music:lastfm:get-status', async () => {
    requireAdvancedFeatures();
    return lastFmEnricher?.refreshStatus() || { enabled: false, configured: false };
  });
  ipcMain.handle('music:lastfm:set-settings', async (_event, settings) => {
    requireAdvancedFeatures();
    const preferences = storage.setLastFmSettings(settings || {});
    lastFmEnricher?.configure();
    sendToAll('ui:preferences-changed', preferences);
    return preferences;
  });
  ipcMain.handle('music:lastfm:test', async () => {
    requireAdvancedFeatures();
    return lastFmEnricher?.testConnection();
  });
  ipcMain.handle('music:lastfm:queue-full', async () => {
    requireAdvancedFeatures();
    await musicLibrary.enable();
    return lastFmEnricher.queueFullRefresh();
  });
  ipcMain.handle('music:local-radio:set-familiarity', (_event, familiarity) => {
    requireAdvancedFeatures();
    const preferences = storage.setLocalRadioFamiliarity(String(familiarity || ''));
    sendToAll('ui:preferences-changed', preferences);
    return preferences;
  });

  const requireAdvancedFeatures = () => {
    if (!storage.getUiPreferences().proModeEnabled) {
      throw new Error('Enable Advanced Features in Settings before using Local Music.');
    }
  };
  ipcMain.handle('music:debug:get-last-decision', () => musicRadio?.getLastDecision() || null);
  ipcMain.handle('music:debug:save-log', async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultPath = path.join(getDataDir(), `WaveDeck_Radio_Diagnostics_${timestamp}.json`);
    const result = await dialog.showSaveDialog(radioLogWindow || mainWindow, {
      title: 'Save Radio Diagnostics',
      defaultPath,
      filters: [{ name: 'JSON diagnostic log', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true, count: radioDiagnosticSession.length };
    const diagnostics = {
      format: 'WaveDeck Radio Diagnostics',
      schemaVersion: 2,
      appVersion: DISPLAY_VERSION,
      exportedAt: new Date().toISOString(),
      selectionCount: radioDiagnosticSession.length,
      selections: radioDiagnosticSession
    };
    await fs.promises.writeFile(result.filePath, JSON.stringify(diagnostics, null, 2) + '\n', 'utf8');
    return { canceled: false, count: radioDiagnosticSession.length, filePath: result.filePath };
  });

  // Retain the original channels for older renderer bundles and portable data
  // created before the preference became available on Windows.
  ipcMain.handle("linux-ui:get-preferences", () => storage.getUiPreferences());
  ipcMain.handle("linux-ui:set-launch-in-sidebar", (_event, enabled) => {
    if (process.platform !== "linux" && process.platform !== "win32") {
      throw new Error("Sidebar launch is not available on this operating system.");
    }
    return storage.setLaunchInSidebarMode(enabled);
  });

  ipcMain.handle("player:status", () => mediaController.getStatus());
  const requireMusic = async () => {
    if (!storage.getUiPreferences().proModeEnabled) throw new Error('Enable Advanced Features to use Music.');
    await musicLibrary.enable();
    lastFmEnricher?.configure();
  };
  ipcMain.handle('music:status', async () => { await requireMusic(); return musicLibrary.call('status'); });
  ipcMain.handle('music:search', async (_event, query) => { await requireMusic(); return musicLibrary.call('search', String(query || '')); });
  ipcMain.handle('music:scan', async () => { await requireMusic(); return musicLibrary.rescan(); });
  ipcMain.handle('music:play', async (_event, id, mode) => { await requireMusic(); return mediaController.playMusic(String(id), mode); });
  ipcMain.handle('music:seek', async (_event, seconds) => {
    if (mediaController.music) await player.seek(seconds);
  });
  ipcMain.handle("player:play-station", (_event, stationId) => mediaController.playStationById(stationId));
  ipcMain.handle("player:play-pause", () => mediaController.togglePlayPause());
  ipcMain.handle("player:previous-preset", () => mediaController.previousPreset());
  ipcMain.handle("player:next-preset", () => mediaController.nextPreset());
  ipcMain.handle("player:stop", () => mediaController.stop());
  ipcMain.handle("player:volume", (_event, value) => player.setVolume(value));
  ipcMain.handle("player:mute", () => player.toggleMute());

  ipcMain.handle("recording:get-state", () => recorder?.getState() || {
    available: false,
    active: false,
    finalizing: false,
    error: ""
  });
  ipcMain.handle("recording:toggle", async () => {
    if (!storage.getUiPreferences().proModeEnabled) {
      throw new Error("Turn on Advanced Features in Settings before recording.");
    }
    if (!recorder?.isAvailable()) {
      throw new Error("Stream recording is available in the Linux edition.");
    }
    if (recorder.isRecording()) return recorder.stop();
    const station = mediaController.getCurrentStation();
    if (!station || mediaController.getMediaState() !== "playing") {
      throw new Error("Start a station before recording.");
    }
    return recorder.start(station);
  });

  ipcMain.handle("recordings:list", () => recordingLibrary?.list() || []);
  ipcMain.handle("recordings:play", async (_event, recordingId) => {
    if (!storage.getUiPreferences().proModeEnabled) {
      throw new Error("Turn on Advanced Features in Settings before playing recordings.");
    }
    const recording = recordingLibrary?.get(recordingId);
    if (!recording) throw new Error("That recording is no longer available.");
    return mediaController.playRecording(recording);
  });
  ipcMain.handle("recordings:reveal", (_event, recordingId) => {
    const recording = recordingLibrary?.get(recordingId);
    if (!recording) throw new Error("That recording is no longer available.");
    shell.showItemInFolder(recording.path);
    return true;
  });
  ipcMain.handle("recordings:delete", async (_event, recordingId) => {
    const recording = recordingLibrary?.get(recordingId);
    if (!recording) throw new Error("That recording is no longer available.");
    if (String(mediaController.getStatus().currentRecording?.id) === recording.id) {
      await mediaController.stop();
    }
    await shell.trashItem(recording.path);
    sendToMain("recordings:changed");
    return true;
  });

  ipcMain.handle("settings:open", (_event, stationId = "") => {
    openSettingsWindow(stationId);
    return true;
  });

  ipcMain.handle("sidebar:get-state", () => getSidebarState());
  ipcMain.handle("sidebar:toggle", () => setSidebarMode(!sidebarApplied));

  ipcMain.handle("app:info", () => ({
    version: DISPLAY_VERSION,
    platform: process.platform,
    portable: isPortableBuild(),
    dataDir: storage.dataDir
  }));
}

configurePortableRuntimePaths();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    storage = new PortableStorage({
      dataDir: getDataDir(),
      defaultsDir: getDefaultsDir(),
      onWarning: (message) => {
        startupWarnings.push(message);
        sendToAll("app:warning", message);
      }
    });

    if (process.platform === "win32") {
      windowsSidebar = new WindowsSidebar({
        helperPath: resolveWindowsSidebarHelper({
          packaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          projectRoot: PROJECT_ROOT
        }),
        onUnexpectedExit: () => {
          if (!sidebarApplied || !mainWindow || mainWindow.isDestroyed()) return;
          sidebarApplied = false;
          try {
            mainWindow.setAlwaysOnTop(false);
            mainWindow.setSkipTaskbar(false);
            mainWindow.setResizable(true);
            mainWindow.setMovable(true);
            mainWindow.setMinimizable(true);
            mainWindow.setMaximizable(true);
            if (floatingBounds) mainWindow.setBounds(floatingBounds);
          } catch {}
          const message = "Windows released Sidebar Mode unexpectedly. WaveDeck returned to its normal window.";
          startupWarnings.push(message);
          sendToMain("app:warning", message);
          sendToMain("sidebar:state-changed", getSidebarState());
        }
      });
    }

    try {
      storage.initialize();
      storage.assertWritable();
      sectionVisibility = storage.getStreamingUiState();
    } catch (error) {
      startupWarnings.push(`WaveDeck's Data folder is not writable. Changes may not be saved. ${error.message}`);
    }

    if (process.platform === "linux") {
      try {
        const recorderExecutable = prepareFfmpegExecutable({
          executable: resolveFfmpegExecutable({ packaged: app.isPackaged }),
          runtimeDir: getRuntimeDir(),
          packaged: app.isPackaged
        });
        recordingProbeExecutable = prepareFfprobeExecutable({
          executable: resolveFfprobeExecutable({ packaged: app.isPackaged }),
          runtimeDir: getRuntimeDir(),
          packaged: app.isPackaged
        });
        verifyFfmpegExecutable({
          executable: recorderExecutable,
          runtimeDir: getRuntimeDir()
        });
        recorder = new StreamRecorder({
          executable: recorderExecutable,
          recordingsDir: getRecordingsDir(),
          onStateChanged: broadcastRecordingState
        });
        recorder.initialize();
      } catch (error) {
        console.warn(`Stream recording is unavailable: ${error.message}`);
      }
    }

    recordingLibrary = new RecordingLibrary({
      recordingsDir: getRecordingsDir(),
      probeExecutable: recordingProbeExecutable
    });
    recordingLibrary.ensureDirectory();

    libraryUpdater = createLibraryUpdater({
      storage,
      fetchImpl: (...args) => net.fetch(...args),
      fallbackFetchImpl: nodeHttpsFetch,
      isPaused: () => Boolean(settingsWindow && !settingsWindow.isDestroyed()),
      onApplied: (result) => {
        if (result.addedStations || result.updatedStations) sendToMain("stations:changed");
        if (result.addedGroups) sendToMain("groups:changed");
        if (result.addedSubgroups) sendToMain("subgroups:changed");
        if (result.addedStations || result.updatedStations) mprisService?.update();
      }
    });

    const ipcPath = getIpcPath(process.platform, app.getPath("userData"));
    const executable = getMpvExecutable({
      platform: process.platform,
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      projectRoot: PROJECT_ROOT
    });

    player = new MpvPlayer({
      executable,
      ipcPath,
      onMetadata: (metadata) => sendToMain("player:metadata", metadata),
      onStatus: (status) => broadcastPlayerStatus(status),
      onEnded: (event) => { void mediaController?.handleEnded(event); }
    });

    mediaController = serializeTransport(new MediaController({
      player,
      getStations: () => storage.readStations(),
      onStationChanged: broadcastStationChanged,
      onStateChanged: broadcastPlayerStatus,
      beforeStationChange: () => recorder?.stop(),
      beforeStop: () => recorder?.stop()
    }));

    musicLibrary = new MusicLibrary({ dataDir: getDataDir(), additionalMusicFolder: storage.getUiPreferences().additionalMusicFolder, onStatus: status => sendToMain('music:changed', status) });
    musicRadio = new MusicRadio({ dataDir: getDataDir(), onDecision: sendToRadioLog, getFamiliarity: () => storage.getUiPreferences().localRadioFamiliarity });
    lastFmEnricher = new LastFmEnricher({
      library: musicLibrary,
      getPreferences: () => storage.getUiPreferences(),
      fetchImpl: (...args) => net.fetch(...args),
      onStatus: sendLastFmStatus
    });
    mediaController.configureMusic(musicLibrary, musicRadio, track => { void lastFmEnricher.queueAlbum(track.id); });
    lastFmEnricher.configure();
    if (storage.getUiPreferences().proModeEnabled) void musicLibrary.enable({ scanOnEnable: true }).then(() => lastFmEnricher.configure()).catch(error => sendToMain('app:warning', error.message));

    listeningHistory = new ListeningHistory({
      storage,
      onChanged: (history) => sendToAll("listening:changed", history)
    });

    if (MprisService) {
      mprisService = new MprisService({
        controller: mediaController,
        onRaise: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        },
        onWarning: (message) => {
          console.warn(message);
        }
      });
    }

    if (PlatformMediaKeys) {
      platformMediaKeys = new PlatformMediaKeys({
        controller: mediaController,
        globalShortcut,
        onWarning: (message) => {
          console.warn(message);
        }
      });
    }

    installIpcHandlers();
    if (!globalShortcut.register(RADIO_LOG_SHORTCUT, openRadioLogWindow)) {
      console.warn("WaveDeck could not register the Live Radio Log shortcut.");
    }
    if (!globalShortcut.register(LASTFM_REFRESH_SHORTCUT, () => {
      void (async () => {
        try {
          await musicLibrary?.enable();
          const status = await lastFmEnricher?.queueFullRefresh();
          sendToMain('app:warning', `Full Last.fm refresh queued: ${status?.tracksCurrent || 0} of ${status?.tracksTotal || 0} tracks currently up to date.`);
        } catch (error) { sendToMain('app:warning', error.message); }
      })();
    })) {
      console.warn("WaveDeck could not register the Last.fm refresh shortcut.");
    }
    const supportsStartupSidebar = process.platform === "linux" || process.platform === "win32";
    const launchInSidebarMode = supportsStartupSidebar &&
      storage.getUiPreferences().launchInSidebarMode === true;
    const initialWindow = createMainWindow({ showOnReady: !launchInSidebarMode });
    scheduleLibraryUpdateCheck();

    initialWindow.webContents.once("did-finish-load", () => {
      for (const warning of startupWarnings) sendToMain("app:warning", warning);
    });

    try {
      await player.start();
    } catch (error) {
      console.error(error.message);
    }
    startPlaybackHeartbeat();

    await mprisService?.start();
    await platformMediaKeys?.start();
    mediaKeyReclaimEnabled = Boolean(platformMediaKeys);
    if (mediaKeyReclaimEnabled) startMediaKeyReclaim();

    if (launchInSidebarMode) {
      try {
        await initialWindow.waveDeckLoadPromise;
        await setSidebarMode(true);
      } catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
        const message = `WaveDeck could not start in Sidebar Mode. ${error.message}`;
        console.warn(message);
        sendToMain("app:warning", message);
      }
    }
  });
}

function finishShutdown() {
  if (cleanupComplete) return;
  cleanupComplete = true;
  if (libraryUpdateTimer) clearTimeout(libraryUpdateTimer);
  libraryUpdateTimer = null;
  if (playbackHeartbeat) clearInterval(playbackHeartbeat);
  playbackHeartbeat = null;
  if (mediaKeyReclaimTimer) clearInterval(mediaKeyReclaimTimer);
  mediaKeyReclaimTimer = null;
  mediaKeyReclaimEnabled = false;
  try { globalShortcut.unregister(RADIO_LOG_SHORTCUT); } catch {}
  try { globalShortcut.unregister(LASTFM_REFRESH_SHORTCUT); } catch {}
  lastFmEnricher?.stop();
  listeningHistory?.close();
  platformMediaKeys?.close();
  mprisService?.close();
  windowsSidebar?.close();
  player?.close();
  mediaController?.clearMusic();
  musicLibrary?.close();
}

app.on("before-quit", (event) => {
  if (!quitFinalizingRecording && recorder?.isRecording()) {
    event.preventDefault();
    quitFinalizingRecording = true;
    void recorder.close().finally(() => {
      finishShutdown();
      app.quit();
    });
    return;
  }
  finishShutdown();
});
app.on("window-all-closed", () => app.quit());

module.exports = { getDataDir };
