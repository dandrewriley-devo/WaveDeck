const { app, BrowserWindow, dialog, ipcMain, Menu, screen } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { MpvPlayer, getIpcPath, getMpvExecutable } = require("./player");
const { MediaController } = require("./media-controller");
const { MprisService } = require("./mpris");
const { CinnamonMediaKeys } = require("./cinnamon-media-keys");
const { ListeningHistory } = require("./listening-history");
const { copyLegacyData } = require("./data-migration");
const {
  getLauncherStatus,
  installLauncher,
  removeLauncher
} = require("./desktop-launcher");
const { resolveDataDir, resolveLegacyDataDirs, resolvePortableState } = require("./portable-paths");
const { PortableStorage, validateStations } = require("./storage");
const { probeStream } = require("./stream-probe");
const {
  clearCinnamonReservedSpace,
  setCinnamonReservedSpace
} = require("./cinnamon-reservation");
const {
  SIDEBAR_WIDTH,
  sidebarAvailability
} = require("./sidebar");
const { calculateBottomRightBounds, calculateCenteredBounds } = require("./window-layout");

const FIXED_WIDTH = SIDEBAR_WIDTH;
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const FLOATING_NATIVE_TITLE = "WaveDeck";
const SIDEBAR_NATIVE_TITLE = "WaveDeck Sidebar";
const SIDEBAR_REALIZE_DELAY_MS = 150;
const MEDIA_KEY_RECLAIM_INTERVAL_MS = 15_000;
const PLAYBACK_HEARTBEAT_MS = 10_000;

let mainWindow = null;
let settingsWindow = null;
let storage = null;
let player = null;
let mediaController = null;
let mprisService = null;
let cinnamonMediaKeys = null;
let listeningHistory = null;
let playbackHeartbeat = null;
let mediaKeyReclaimTimer = null;
let mediaKeyReclaimEnabled = false;
let sidebarApplied = false;
let sidebarTransitioning = false;
let floatingBounds = null;
let sectionVisibility = { presets: true, mostPlayed: false };
const startupWarnings = [];

function getDataDir() {
  return resolveDataDir({
    envDataDir: process.env.WAVEDECK_DATA_DIR || process.env.WAVEDECKSB_DATA_DIR,
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImagePath: process.env.APPIMAGE,
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
        startupWarnings.push("Your existing WaveDeckSB stations and presets were copied into WaveDeck-Data. The original folder was left untouched as a backup.");
      }
    } catch (error) {
      startupWarnings.push(`WaveDeck could not copy the previous WaveDeckSB data automatically: ${error.message}`);
    }
  }
  if (!isPortableBuild()) return;
  const runtimeDir = path.join(getDataDir(), "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  app.setPath("userData", runtimeDir);
  app.setPath("sessionData", runtimeDir);
}

function getDefaultsDir() {
  return path.join(app.getAppPath(), "defaults");
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

function reclaimMediaKeys() {
  if (!mediaKeyReclaimEnabled) return;
  void cinnamonMediaKeys?.claim({ reconnect: true }).catch((error) => {
    console.warn(`Could not reclaim Cinnamon media keys: ${error.message}`);
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
    type: sidebar ? "dock" : undefined
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
  settingsWindow = createSecureWindow({
    ...calculateCenteredBounds(display, 860, 620),
    minWidth: 700,
    minHeight: 500,
    resizable: true,
    title: "WaveDeck Settings"
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
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

function getSidebarState() {
  const availability = sidebarAvailability();
  return {
    ...availability,
    enabled: availability.available && sidebarApplied
  };
}

async function setSidebarMode(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("The WaveDeck window is unavailable.");
  if (sidebarTransitioning) return getSidebarState();
  sidebarTransitioning = true;

  try {
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

  ipcMain.handle("stations:export", async () => {
    const stations = storage.readStations();
    const result = await dialog.showSaveDialog(settingsWindow || mainWindow, {
      title: "Export WaveDeck stations",
      defaultPath: path.join(app.getPath("documents"), "wavedeck-stations.json"),
      filters: [{ name: "JSON files", extensions: ["json"] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, `${JSON.stringify(stations, null, 2)}\n`, "utf8");
    return { canceled: false, filePath: result.filePath, count: stations.length };
  });

  ipcMain.handle("stations:import-replace", async () => {
    const result = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      title: "Import WaveDeck stations",
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

    const stations = validateStations(parsed);
    storage.writeStations(stations);
    storage.syncGroupsWithStations(stations);
    storage.syncSubgroupsWithStations(stations);
    sendToAll("stations:changed");
    sendToAll("groups:changed");
    sendToAll("subgroups:changed");
    mprisService?.update();
    return { canceled: false, filePath: importPath, count: stations.length };
  });

  ipcMain.handle("stream:test", (_event, url) => probeStream(url));

  ipcMain.handle("notepad:get", () => storage.readNotepad());
  ipcMain.handle("notepad:save", (_event, value) => storage.writeNotepad(value));
  ipcMain.on("notepad:save-immediate", (_event, value) => {
    try {
      storage.writeNotepad(value);
    } catch (error) {
      console.error(`Could not save WaveDeck notepad: ${error.message}`);
    }
  });

  ipcMain.handle("listening:get", () => listeningHistory.getStats());
  ipcMain.handle("listening:reset", () => listeningHistory.reset());
  ipcMain.handle("sections:get-state", () => ({ ...sectionVisibility }));
  ipcMain.handle("sections:set-state", (_event, state = {}) => {
    sectionVisibility = {
      presets: typeof state.presets === "boolean" ? state.presets : sectionVisibility.presets,
      mostPlayed: typeof state.mostPlayed === "boolean" ? state.mostPlayed : sectionVisibility.mostPlayed
    };
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

  ipcMain.handle("player:status", () => mediaController.getStatus());
  ipcMain.handle("player:play-station", (_event, stationId) => mediaController.playStationById(stationId));
  ipcMain.handle("player:stop", () => mediaController.stop());
  ipcMain.handle("player:volume", (_event, value) => player.setVolume(value));
  ipcMain.handle("player:mute", () => player.toggleMute());

  ipcMain.handle("settings:open", (_event, stationId = "") => {
    openSettingsWindow(stationId);
    return true;
  });

  ipcMain.handle("sidebar:get-state", () => getSidebarState());
  ipcMain.handle("sidebar:toggle", () => setSidebarMode(!sidebarApplied));

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
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

    try {
      storage.initialize();
      storage.assertWritable();
    } catch (error) {
      startupWarnings.push(`WaveDeck's Data folder is not writable. Changes may not be saved. ${error.message}`);
    }

    const ipcPath = getIpcPath(process.platform, storage.dataDir);
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
      onStatus: (status) => broadcastPlayerStatus(status)
    });

    mediaController = new MediaController({
      player,
      getStations: () => storage.readStations(),
      onStationChanged: broadcastStationChanged,
      onStateChanged: broadcastPlayerStatus
    });

    listeningHistory = new ListeningHistory({
      storage,
      onChanged: (history) => sendToAll("listening:changed", history)
    });

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

    cinnamonMediaKeys = new CinnamonMediaKeys({
      controller: mediaController,
      onWarning: (message) => {
        console.warn(message);
      }
    });

    installIpcHandlers();
    createMainWindow();

    mainWindow.webContents.once("did-finish-load", () => {
      for (const warning of startupWarnings) sendToMain("app:warning", warning);
    });

    try {
      await player.start();
    } catch (error) {
      console.error(error.message);
    }
    startPlaybackHeartbeat();

    await mprisService.start();
    await cinnamonMediaKeys.start();
    mediaKeyReclaimEnabled = true;
    startMediaKeyReclaim();
  });
}

app.on("before-quit", () => {
  if (playbackHeartbeat) clearInterval(playbackHeartbeat);
  playbackHeartbeat = null;
  if (mediaKeyReclaimTimer) clearInterval(mediaKeyReclaimTimer);
  mediaKeyReclaimTimer = null;
  mediaKeyReclaimEnabled = false;
  listeningHistory?.close();
  cinnamonMediaKeys?.close();
  mprisService?.close();
  player?.close();
});
app.on("window-all-closed", () => app.quit());

module.exports = { getDataDir };
