const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("wavedeck", {
  platform: process.platform,
  getMusicStatus: () => ipcRenderer.invoke('music:status'),
  searchMusic: query => ipcRenderer.invoke('music:search', query),
  scanMusic: () => ipcRenderer.invoke('music:scan'),
  playMusic: (id, mode) => ipcRenderer.invoke('music:play', id, mode),
  seekMusic: seconds => ipcRenderer.invoke('music:seek', seconds),
  getMusicDebugLog: () => ipcRenderer.invoke('music:debug:get-last-decision'),
  saveMusicDebugLog: () => ipcRenderer.invoke('music:debug:save-log'),
  getLastFmStatus: () => ipcRenderer.invoke('music:lastfm:get-status'),
  setLastFmSettings: settings => ipcRenderer.invoke('music:lastfm:set-settings', settings),
  testLastFm: () => ipcRenderer.invoke('music:lastfm:test'),
  queueFullLastFmRefresh: () => ipcRenderer.invoke('music:lastfm:queue-full'),
  onLastFmChanged: callback => subscribe('music:lastfm-changed', callback),
  onMusicDebugLog: callback => subscribe('music:debug-decision', callback),
  onMusicChanged: callback => subscribe('music:changed', callback),
  getStations: () => ipcRenderer.invoke("stations:get"),
  saveStations: (stations) => ipcRenderer.invoke("stations:save", stations),
  deleteStation: (stationId) => ipcRenderer.invoke("stations:delete", stationId),
  setStationGain: (stationId, gainDb) => ipcRenderer.invoke("stations:set-gain", stationId, gainDb),
  onStationsChanged: (callback) => subscribe("stations:changed", callback),
  editStation: (stationId) => ipcRenderer.invoke("settings:open", stationId),
  onEditStationRequested: (callback) => subscribe("settings:edit-station", callback),

  getGroups: () => ipcRenderer.invoke("groups:get"),
  saveGroups: (groups) => ipcRenderer.invoke("groups:save", groups),
  removeGroup: (groupName) => ipcRenderer.invoke("groups:remove", groupName),
  onGroupsChanged: (callback) => subscribe("groups:changed", callback),

  getSubgroups: () => ipcRenderer.invoke("subgroups:get"),
  saveSubgroups: (subgroups) => ipcRenderer.invoke("subgroups:save", subgroups),
  renameSubgroup: (groupName, oldName, newName) => ipcRenderer.invoke("subgroups:rename", groupName, oldName, newName),
  removeSubgroup: (groupName, subgroupName) => ipcRenderer.invoke("subgroups:remove", groupName, subgroupName),
  onSubgroupsChanged: (callback) => subscribe("subgroups:changed", callback),

  getListeningHistory: () => ipcRenderer.invoke("listening:get"),
  resetListeningHistory: () => ipcRenderer.invoke("listening:reset"),
  onListeningHistoryChanged: (callback) => subscribe("listening:changed", callback),

  getSectionVisibility: () => ipcRenderer.invoke("sections:get-state"),
  setSectionVisibility: (state) => ipcRenderer.invoke("sections:set-state", state),
  onSectionVisibilityChanged: (callback) => subscribe("sections:state-changed", callback),

  getLauncherStatus: () => ipcRenderer.invoke("launcher:get-status"),
  installLauncher: () => ipcRenderer.invoke("launcher:install"),
  removeLauncher: () => ipcRenderer.invoke("launcher:remove"),
  getUiPreferences: () => ipcRenderer.invoke("ui:get-preferences"),
  setLaunchInSidebarMode: (enabled) => ipcRenderer.invoke("ui:set-launch-in-sidebar", enabled),
  setProModeEnabled: (enabled) => ipcRenderer.invoke("ui:set-pro-mode", enabled),
  chooseAdditionalMusicFolder: () => ipcRenderer.invoke('ui:choose-additional-music-folder'),
  setAdditionalMusicFolder: (folder) => ipcRenderer.invoke('ui:set-additional-music-folder', folder),
  onUiPreferencesChanged: (callback) => subscribe("ui:preferences-changed", callback),

  exportLibrary: () => ipcRenderer.invoke("library:export"),
  importLibrary: (mode) => ipcRenderer.invoke("library:import", mode),
  getLibraryUpdateState: () => ipcRenderer.invoke("library-update:get-state"),
  setLibraryUpdatesEnabled: (enabled) => ipcRenderer.invoke("library-update:set-enabled", enabled),
  testStreamUrl: (url) => ipcRenderer.invoke("stream:test", url),

  playStation: (stationId) => ipcRenderer.invoke("player:play-station", stationId),
  playPause: () => ipcRenderer.invoke("player:play-pause"),
  previousPreset: () => ipcRenderer.invoke("player:previous-preset"),
  nextPreset: () => ipcRenderer.invoke("player:next-preset"),
  stop: () => ipcRenderer.invoke("player:stop"),
  setVolume: (value) => ipcRenderer.invoke("player:volume", value),
  toggleMute: () => ipcRenderer.invoke("player:mute"),
  getPlayerStatus: () => ipcRenderer.invoke("player:status"),
  onPlayerStatus: (callback) => subscribe("player:status-changed", callback),
  onStationChanged: (callback) => subscribe("player:station-changed", callback),
  onMetadata: (callback) => subscribe("player:metadata", callback),

  getRecordingState: () => ipcRenderer.invoke("recording:get-state"),
  toggleRecording: () => ipcRenderer.invoke("recording:toggle"),
  onRecordingState: (callback) => subscribe("recording:state-changed", callback),
  getRecordings: () => ipcRenderer.invoke("recordings:list"),
  playRecording: (recordingId) => ipcRenderer.invoke("recordings:play", recordingId),
  revealRecording: (recordingId) => ipcRenderer.invoke("recordings:reveal", recordingId),
  deleteRecording: (recordingId) => ipcRenderer.invoke("recordings:delete", recordingId),
  onRecordingsChanged: (callback) => subscribe("recordings:changed", callback),

  getSidebarState: () => ipcRenderer.invoke("sidebar:get-state"),
  toggleSidebar: () => ipcRenderer.invoke("sidebar:toggle"),
  onSidebarState: (callback) => subscribe("sidebar:state-changed", callback),

  openSettings: (stationId = "") => ipcRenderer.invoke("settings:open", stationId),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  onWarning: (callback) => subscribe("app:warning", callback)
});
