const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("wavedeck", {
  platform: process.platform,
  getStations: () => ipcRenderer.invoke("stations:get"),
  saveStations: (stations) => ipcRenderer.invoke("stations:save", stations),
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

  getNotepad: () => ipcRenderer.invoke("notepad:get"),
  saveNotepad: (value) => ipcRenderer.invoke("notepad:save", value),
  saveNotepadImmediate: (value) => ipcRenderer.send("notepad:save-immediate", value),

  getListeningHistory: () => ipcRenderer.invoke("listening:get"),
  resetListeningHistory: () => ipcRenderer.invoke("listening:reset"),
  onListeningHistoryChanged: (callback) => subscribe("listening:changed", callback),

  getSectionVisibility: () => ipcRenderer.invoke("sections:get-state"),
  setSectionVisibility: (state) => ipcRenderer.invoke("sections:set-state", state),
  onSectionVisibilityChanged: (callback) => subscribe("sections:state-changed", callback),

  getLauncherStatus: () => ipcRenderer.invoke("launcher:get-status"),
  installLauncher: () => ipcRenderer.invoke("launcher:install"),
  removeLauncher: () => ipcRenderer.invoke("launcher:remove"),

  exportStations: () => ipcRenderer.invoke("stations:export"),
  importStationsReplace: () => ipcRenderer.invoke("stations:import-replace"),
  testStreamUrl: (url) => ipcRenderer.invoke("stream:test", url),

  playStation: (stationId) => ipcRenderer.invoke("player:play-station", stationId),
  stop: () => ipcRenderer.invoke("player:stop"),
  setVolume: (value) => ipcRenderer.invoke("player:volume", value),
  toggleMute: () => ipcRenderer.invoke("player:mute"),
  getPlayerStatus: () => ipcRenderer.invoke("player:status"),
  onPlayerStatus: (callback) => subscribe("player:status-changed", callback),
  onStationChanged: (callback) => subscribe("player:station-changed", callback),
  onMetadata: (callback) => subscribe("player:metadata", callback),

  getSidebarState: () => ipcRenderer.invoke("sidebar:get-state"),
  toggleSidebar: () => ipcRenderer.invoke("sidebar:toggle"),
  onSidebarState: (callback) => subscribe("sidebar:state-changed", callback),

  openSettings: (stationId = "") => ipcRenderer.invoke("settings:open", stationId),
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  onWarning: (callback) => subscribe("app:warning", callback)
});
