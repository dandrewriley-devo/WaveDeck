const headerStationName = document.querySelector(".station-name");
const nowPlaying = document.getElementById("nowPlaying");
const muteBtn = document.getElementById("muteBtn");
const muteIcon = document.getElementById("muteIcon");
const previousPresetBtn = document.getElementById("previousPresetBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const playPauseIcon = document.getElementById("playPauseIcon");
const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const nextPresetBtn = document.getElementById("nextPresetBtn");
const volumeSlider = document.getElementById("volSlider");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const searchSectionToggleBtn = document.getElementById("searchSectionToggleBtn");
const presetSectionToggleBtn = document.getElementById("presetSectionToggleBtn");
const favoritesOnlyToggleBtn = document.getElementById("favoritesOnlyToggleBtn");
const mostPlayedSectionToggleBtn = document.getElementById("mostPlayedSectionToggleBtn");
const recordingsSectionToggleBtn = document.getElementById("recordingsSectionToggleBtn");
const sidebarModeBtn = document.getElementById("sidebarModeBtn");
const notepadToggleBtn = document.getElementById("notepadToggleBtn");
const notepadPanel = document.getElementById("notepadPanel");
const notepadText = document.getElementById("notepadText");
const searchPanel = document.getElementById("searchPanel");
const stationSearchInput = document.getElementById("stationSearchInput");
const clearStationSearchBtn = document.getElementById("clearStationSearchBtn");
const recordingsPanel = document.getElementById("recordingsPanel");
const recordingSearchInput = document.getElementById("recordingSearchInput");
const clearRecordingSearchBtn = document.getElementById("clearRecordingSearchBtn");
const listEl = document.querySelector(".list");
const platform = window.wavedeck.platform;

if (platform !== "linux" && platform !== "win32") sidebarModeBtn.hidden = true;

let currentStationId = null;
let currentRecordingId = null;
let isMuted = false;
let renderQueued = false;
let volumeTimer = null;
let notepadSaveTimer = null;
let notepadDirty = false;
let notepadOpen = false;
let sidebarModeEnabled = false;
let proModeEnabled = false;
let recordingState = { available: false, active: false, finalizing: false };
let recordingClock = null;
let searchSectionVisible = false;
let presetSectionVisible = true;
let favoritesOnlyVisible = false;
let mostPlayedSectionVisible = false;
let recordingsSectionVisible = false;
let stationSearchQuery = "";
let recordingSearchQuery = "";
let searchRenderTimer = null;
let recordingSearchRenderTimer = null;
const stationGainTimers = new Map();
const stationGainVersions = new Map();
let focusSearchAfterRender = false;
let focusRecordingSearchAfterRender = false;
let selectedRecordingId = "";
let draggedPresetId = null;
let listeningHistory = { version: 1, stations: {} };
let currentPlayerStatus = null;
let expandedStationId = "";
const collapsedGroups = new Set();
const collapsedSubgroups = new Set();
let collapseStateInitialized = false;
let renderedGroupNames = [];
let renderedSubgroupKeys = [];
const MOST_LISTENED_MINIMUM_SECONDS = 5 * 60;

const ICON_SPEAKER_WAVE = `
  <path d="M8.25 6.75 4.5 9H2.25A.75.75 0 0 0 1.5 9.75v4.5c0 .414.336.75.75.75H4.5l3.75 2.25V6.75Z"/>
  <path d="M14.75 8.75a.75.75 0 0 1 1.06 0 4.5 4.5 0 0 1 0 6.364.75.75 0 1 1-1.06-1.06 3 3 0 0 0 0-4.244.75.75 0 0 1 0-1.06Z"/>
  <path d="M17.5 6a.75.75 0 0 1 1.06 0 8.25 8.25 0 0 1 0 12 .75.75 0 1 1-1.06-1.06 6.75 6.75 0 0 0 0-9.88.75.75 0 0 1 0-1.06Z"/>
`;

const ICON_SPEAKER_X = `
  <path d="M8.25 6.75 4.5 9H2.25A.75.75 0 0 0 1.5 9.75v4.5c0 .414.336.75.75.75H4.5l3.75 2.25V6.75Z"/>
  <path d="M15.47 8.97a.75.75 0 0 1 1.06 0l1.5 1.5 1.5-1.5a.75.75 0 0 1 1.06 1.06l-1.5 1.5 1.5 1.5a.75.75 0 1 1-1.06 1.06l-1.5-1.5-1.5 1.5a.75.75 0 0 1-1.06-1.06l1.5-1.5-1.5-1.5a.75.75 0 0 1 0-1.06Z"/>
`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function normalizeGroupName(value) {
  return String(value ?? "").trim() || "Other";
}

function sortByName(a, b) {
  return String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, {
    sensitivity: "base"
  });
}

function presetRank(station) {
  const raw = station?.presetOrder;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sortPresets(a, b) {
  const aRank = presetRank(a);
  const bRank = presetRank(b);
  if (aRank !== null && bRank !== null && aRank !== bRank) return aRank - bRank;
  if (aRank !== null && bRank === null) return -1;
  if (aRank === null && bRank !== null) return 1;
  return sortByName(a, b);
}

function normalizePresetOrder(stations) {
  const presets = stations.filter((station) => station.preset).sort(sortPresets);
  presets.forEach((station, index) => { station.presetOrder = index; });
  stations.filter((station) => !station.preset).forEach((station) => { station.presetOrder = null; });
  return presets;
}

function setPresetState(stations, station, preset) {
  const next = Boolean(preset);
  if (next === Boolean(station.preset)) return;
  if (next) {
    const presets = normalizePresetOrder(stations);
    station.preset = true;
    station.presetOrder = presets.length;
  } else {
    station.preset = false;
    station.presetOrder = null;
    normalizePresetOrder(stations);
  }
}

function setMuteUi(muted) {
  isMuted = Boolean(muted);
  muteIcon.innerHTML = isMuted ? ICON_SPEAKER_X : ICON_SPEAKER_WAVE;
  muteBtn.title = isMuted ? "Unmute" : "Mute";
  muteBtn.setAttribute("aria-label", isMuted ? "Unmute" : "Mute");
}

function formatElapsed(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function recordingElapsedSeconds() {
  const startedAt = Date.parse(recordingState?.startedAt || "");
  if (!Number.isFinite(startedAt)) return Number(recordingState?.elapsedSeconds) || 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function refreshRecordingTitle() {
  if (recordingState?.active) {
    const elapsed = formatElapsed(recordingElapsedSeconds());
    recordBtn.title = `Stop Recording (${elapsed})`;
    recordBtn.setAttribute("aria-label", `Stop recording, elapsed ${elapsed}`);
  } else if (recordingState?.finalizing) {
    recordBtn.title = "Finishing recording…";
    recordBtn.setAttribute("aria-label", "Finishing recording");
  } else {
    recordBtn.title = recordingState?.available ? "Record" : "Recording unavailable";
    recordBtn.setAttribute("aria-label", "Start recording");
  }
}

function setRecordingUi(state = {}) {
  recordingState = { ...recordingState, ...state };
  const active = recordingState.active === true;
  const finalizing = recordingState.finalizing === true;
  recordBtn.classList.toggle("recording", active || finalizing);
  recordBtn.disabled = !proModeEnabled || recordingState.available !== true || finalizing;
  clearInterval(recordingClock);
  recordingClock = null;
  refreshRecordingTitle();
  if (active) {
    recordingClock = setInterval(refreshRecordingTitle, 1000);
  }
}

function setPlayPauseUi(status = currentPlayerStatus) {
  const playing = status?.mediaState === "playing";
  playPauseIcon.innerHTML = playing
    ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'
    : '<path d="m8 5 11 7-11 7z" fill="currentColor"/>';
  playPauseBtn.title = playing ? "Pause" : "Play";
  playPauseBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function setProModeUi(preferences = {}) {
  proModeEnabled = preferences?.proModeEnabled === true;
  document.querySelectorAll("[data-pro-only]").forEach((node) => {
    node.hidden = !proModeEnabled;
  });
  notepadToggleBtn.hidden = !proModeEnabled || !sidebarModeEnabled;
  if (!proModeEnabled) setNotepadOpen(false);
  if (!proModeEnabled && recordingsSectionVisible) setRecordingsSectionVisible(false);
  setRecordingUi(recordingState);
  queueRender();
}

function setSidebarUi(state) {
  const enabled = state?.enabled === true;
  const changed = sidebarModeEnabled !== enabled;
  const available = state?.available !== false;
  sidebarModeEnabled = enabled;
  sidebarModeBtn.classList.toggle("active", enabled);
  sidebarModeBtn.disabled = !available;
  sidebarModeBtn.setAttribute("aria-pressed", String(enabled));
  sidebarModeBtn.setAttribute("aria-label", enabled ? "Turn Sidebar Mode off" : "Turn Sidebar Mode on");
  sidebarModeBtn.title = available
    ? (enabled ? "Exit Sidebar Mode" : "Sidebar Mode")
    : (state?.reason || "Sidebar Mode unavailable");
  notepadToggleBtn.hidden = !proModeEnabled || !enabled;
  notepadToggleBtn.disabled = !proModeEnabled || !enabled;
  if (!enabled) setNotepadOpen(false);
  if (changed) queueRender();
}

function updateSectionToolbarHighlights() {
  const showingRecordings = recordingsSectionVisible;
  searchSectionToggleBtn.classList.toggle("active", !showingRecordings && searchSectionVisible);
  presetSectionToggleBtn.classList.toggle("active", !showingRecordings && presetSectionVisible);
  favoritesOnlyToggleBtn.classList.toggle("active", !showingRecordings && favoritesOnlyVisible);
  mostPlayedSectionToggleBtn.classList.toggle("active", !showingRecordings && mostPlayedSectionVisible);
  recordingsSectionToggleBtn.classList.toggle("active", showingRecordings);
}

function setSectionVisibilityUi(state = {}) {
  const search = state.search === true;
  const presets = state.presets !== false;
  const favoritesOnly = state.favoritesOnly === true;
  const mostPlayed = state.mostPlayed === true;
  const changed = searchSectionVisible !== search || presetSectionVisible !== presets ||
    favoritesOnlyVisible !== favoritesOnly || mostPlayedSectionVisible !== mostPlayed;
  searchSectionVisible = search;
  presetSectionVisible = presets;
  favoritesOnlyVisible = favoritesOnly;
  mostPlayedSectionVisible = mostPlayed;

  if (!search) {
    stationSearchQuery = "";
    stationSearchInput.value = "";
    clearStationSearchBtn.hidden = true;
    clearTimeout(searchRenderTimer);
    searchRenderTimer = null;
  }

  searchPanel.hidden = !search || recordingsSectionVisible;
  searchPanel.setAttribute("aria-hidden", String(!search || recordingsSectionVisible));

  searchSectionToggleBtn.setAttribute("aria-pressed", String(search));
  searchSectionToggleBtn.setAttribute("aria-label", search ? "Hide Search" : "Show Search");
  presetSectionToggleBtn.setAttribute("aria-pressed", String(presets));
  presetSectionToggleBtn.setAttribute("aria-label", presets ? "Hide Presets" : "Show Presets");
  favoritesOnlyToggleBtn.setAttribute("aria-pressed", String(favoritesOnly));
  favoritesOnlyToggleBtn.setAttribute("aria-label", favoritesOnly ? "Show all Stations" : "Show Favorites only");
  mostPlayedSectionToggleBtn.setAttribute("aria-pressed", String(mostPlayed));
  mostPlayedSectionToggleBtn.setAttribute("aria-label", mostPlayed ? "Hide Your Top Five" : "Show Your Top Five");

  updateSectionToolbarHighlights();

  if (changed) queueRender();
}

function setRecordingsSectionVisible(visible) {
  const next = proModeEnabled && Boolean(visible);
  const changed = recordingsSectionVisible !== next;
  recordingsSectionVisible = next;
  if (!next) {
    recordingSearchQuery = "";
    recordingSearchInput.value = "";
    clearRecordingSearchBtn.hidden = true;
    selectedRecordingId = "";
    clearTimeout(recordingSearchRenderTimer);
    recordingSearchRenderTimer = null;
  }
  recordingsPanel.hidden = !next;
  recordingsPanel.setAttribute("aria-hidden", String(!next));
  searchPanel.hidden = !searchSectionVisible || next;
  searchPanel.setAttribute("aria-hidden", String(!searchSectionVisible || next));
  recordingsSectionToggleBtn.setAttribute("aria-pressed", String(next));
  recordingsSectionToggleBtn.setAttribute("aria-label", next ? "Close Recordings" : "Open Recordings");
  recordingsSectionToggleBtn.title = next ? "Close Recordings" : "Recordings";
  updateSectionToolbarHighlights();
  if (changed) queueRender();
}

function setNotepadOpen(open, { focus = false } = {}) {
  notepadOpen = sidebarModeEnabled && Boolean(open);
  notepadPanel.hidden = !notepadOpen;
  notepadPanel.setAttribute("aria-hidden", String(!notepadOpen));
  notepadToggleBtn.classList.toggle("active", notepadOpen);
  notepadToggleBtn.setAttribute("aria-pressed", String(notepadOpen));
  notepadToggleBtn.setAttribute("aria-label", notepadOpen ? "Close notepad" : "Open notepad");
  notepadToggleBtn.title = notepadOpen ? "Close Notepad" : "Notepad";
  if (notepadOpen && focus) notepadText.focus();
}

async function saveNotepadNow() {
  clearTimeout(notepadSaveTimer);
  notepadSaveTimer = null;
  if (!notepadDirty) return;
  notepadDirty = false;
  try {
    await window.wavedeck.saveNotepad(notepadText.value);
  } catch (error) {
    notepadDirty = true;
    nowPlaying.textContent = `Could not save notepad: ${error.message}`;
  }
}

function formatListeningTime(seconds) {
  const totalMinutes = Math.max(1, Math.floor((Number(seconds) || 0) / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatGainDb(value) {
  const gainDb = Number(value) || 0;
  return `${gainDb > 0 ? "+" : ""}${gainDb} dB`;
}

function updateStationGainUi(stationId, value) {
  const gainDb = Number(value) || 0;
  for (const row of listEl.querySelectorAll(".station")) {
    if (row.dataset.id !== String(stationId)) continue;
    row.dataset.gainDb = String(gainDb);
    const slider = row.querySelector(".station-gain-slider");
    const output = row.querySelector(".station-gain-value");
    const reset = row.querySelector(".station-gain-reset");
    if (slider && document.activeElement !== slider) slider.value = String(gainDb);
    if (output) output.textContent = formatGainDb(gainDb);
    if (reset) reset.disabled = gainDb === 0;
  }
}

async function saveStationGain(stationId, value) {
  const version = (stationGainVersions.get(stationId) || 0) + 1;
  stationGainVersions.set(stationId, version);
  try {
    const result = await window.wavedeck.setStationGain(stationId, value);
    if (stationGainVersions.get(stationId) !== version) return;
    updateStationGainUi(stationId, result.gainDb);
  } catch (error) {
    if (stationGainVersions.get(stationId) !== version) return;
    const row = [...listEl.querySelectorAll(".station")]
      .find((candidate) => candidate.dataset.id === String(stationId));
    updateStationGainUi(stationId, Number(row?.dataset.gainDb) || 0);
    nowPlaying.textContent = `Could not save station gain: ${error.message}`;
  }
}

function createStationRow(station, { presetSection = false, listenedSeconds = 0 } = {}) {
  const row = element("div", `station${String(station.id) === String(currentStationId) ? " active" : ""}`);
  row.dataset.id = String(station.id ?? "");
  row.dataset.url = String(station.url ?? "");
  row.dataset.name = String(station.name ?? "");
  row.dataset.gainDb = String(Number(station.gainDb) || 0);
  row.title = "Click to play • Ctrl-click: Preset • Ctrl+Shift-click: pre-roll • Shift-click: edit";

  const starClasses = ["favBtn"];
  if (station.preset) starClasses.push("preset");
  if (station.hasPreRoll) starClasses.push("has-preroll");
  const favorite = element("button", starClasses.join(" "), station.favorite ? "★" : "☆");
  favorite.type = "button";
  favorite.title = `${station.favorite ? "Remove from" : "Add to"} Favorites`;
  favorite.setAttribute("aria-label", `Toggle favorite for ${station.name}`);

  const meta = element("div", "meta");
  meta.append(element("div", "name", station.name));
  if (listenedSeconds > 0) {
    meta.append(element("div", "listening-time", formatListeningTime(listenedSeconds)));
  }
  if (presetSection) {
    row.classList.add("preset-row");
    const handle = element("button", "drag-handle", "≡");
    handle.type = "button";
    handle.draggable = true;
    handle.title = `Drag to reorder ${station.name}`;
    handle.setAttribute("aria-label", `Drag to reorder ${station.name}`);
    row.append(handle);
  }
  row.append(favorite, meta);
  const info = element("div", "station-info");
  info.hidden = true;
  const facts = element("div", "station-info-facts");
  facts.append(
    element("span", "station-info-country", station.country || "Country unknown"),
    element("span", "station-info-separator", "•"),
    element("span", "station-info-bitrate", "Detecting bitrate…")
  );
  info.append(facts);
  if (station.description) info.append(element("div", "station-description", station.description));
  const gainControl = element("div", "station-gain-control");
  const gainLabel = element("span", "station-gain-label", "Station Gain");
  const gainSlider = element("input", "station-gain-slider");
  gainSlider.type = "range";
  gainSlider.min = "-12";
  gainSlider.max = "12";
  gainSlider.step = "0.5";
  gainSlider.value = row.dataset.gainDb;
  gainSlider.setAttribute("aria-label", `Station gain for ${station.name}`);
  const gainValue = element("output", "station-gain-value", formatGainDb(station.gainDb));
  const gainReset = element("button", "station-gain-reset", "Reset");
  gainReset.type = "button";
  gainReset.disabled = Number(station.gainDb) === 0;
  gainReset.title = "Reset station gain to 0 dB";
  gainControl.append(gainLabel, gainSlider, gainValue, gainReset);
  info.append(gainControl);
  row.append(info);
  return row;
}

function createSectionTitle(title, subtitle = "", action = null) {
  const section = element("div", "section-title");
  const titleRow = element("div", "section-title-row");
  titleRow.append(element("div", "section-main", title));
  if (action) {
    const button = element("button", "section-action", action.label);
    button.type = "button";
    button.id = action.id;
    button.disabled = action.disabled === true;
    titleRow.append(button);
  }
  section.append(titleRow);
  if (subtitle) section.append(element("div", "section-sub", subtitle));
  return section;
}

function subgroupKey(groupName, subgroupName) {
  return `${groupName}\u0000${subgroupName}`;
}

function createSubgroupBlock(groupName, subgroupName, stations) {
  const key = subgroupKey(groupName, subgroupName);
  const subgroup = element("div", "subgroup");
  const header = element("button", "subgroup-header");
  header.type = "button";
  header.dataset.group = groupName;
  header.dataset.subgroup = subgroupName;
  header.append(
    element("span", "subgroup-caret", collapsedSubgroups.has(key) ? "▸" : "▾"),
    element("span", "subgroup-name", subgroupName),
    element("span", "subgroup-count", String(stations.length))
  );
  const body = element("div", "subgroup-body");
  body.hidden = collapsedSubgroups.has(key);
  body.append(...stations.map(createStationRow));
  subgroup.append(header, body);
  return subgroup;
}

function createGroupBlock(groupName, stations, subgroupOrder = []) {
  const group = element("div", "group");
  group.dataset.group = groupName;

  const header = element("button", "group-header");
  header.type = "button";
  header.dataset.group = groupName;
  header.setAttribute("aria-label", `Toggle ${groupName} group`);
  header.append(
    element("span", "caret", collapsedGroups.has(groupName) ? "▸" : "▾"),
    element("span", "group-name", groupName),
    element("span", "group-count", String(stations.length))
  );

  const body = element("div", "group-body");
  body.hidden = collapsedGroups.has(groupName);
  const ungrouped = stations.filter((station) => !String(station.subgroup || "").trim());
  body.append(...ungrouped.map(createStationRow));

  const bySubgroup = new Map();
  for (const station of stations) {
    const subgroup = String(station.subgroup || "").trim();
    if (!subgroup) continue;
    if (!bySubgroup.has(subgroup)) bySubgroup.set(subgroup, []);
    bySubgroup.get(subgroup).push(station);
  }
  const orderedNames = [];
  for (const name of subgroupOrder) {
    if (bySubgroup.has(name) && !orderedNames.includes(name)) orderedNames.push(name);
  }
  for (const name of [...bySubgroup.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))) {
    if (!orderedNames.includes(name)) orderedNames.push(name);
  }
  body.append(...orderedNames.map((name) => createSubgroupBlock(groupName, name, bySubgroup.get(name))));
  group.append(header, body);
  return group;
}

function buildGroupsInOrder(stations, groupOrder) {
  const byGroup = new Map();
  for (const station of stations) {
    const group = normalizeGroupName(station.group);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(station);
  }
  for (const stationList of byGroup.values()) stationList.sort(sortByName);

  const used = new Set();
  const blocks = [];
  for (const rawGroup of groupOrder) {
    const group = normalizeGroupName(rawGroup);
    if (used.has(group)) continue;
    used.add(group);
    if (byGroup.get(group)?.length) blocks.push({ name: group, items: byGroup.get(group) });
  }

  const leftovers = [...byGroup.keys()]
    .filter((group) => !used.has(group) && byGroup.get(group).length)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const group of leftovers) blocks.push({ name: group, items: byGroup.get(group) });
  return blocks;
}

function formatRecordingDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatRecordingDuration(value) {
  if (value === null || value === undefined || value === "") return "Length unavailable";
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (!Number.isFinite(Number(value))) return "Length unavailable";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function playRecording(recording) {
  selectedRecordingId = recording.id;
  currentRecordingId = recording.id;
  headerStationName.textContent = recording.name || "WaveDeck Recording";
  nowPlaying.textContent = "Loading recording…";
  updateActiveHighlight();
  try {
    await window.wavedeck.playRecording(recording.id);
  } catch (error) {
    currentRecordingId = null;
    updateActiveHighlight();
    nowPlaying.textContent = `Could not play recording: ${error.message}`;
  }
}

function createRecordingRow(recording) {
  const active = String(recording.id) === String(currentRecordingId);
  const selected = String(recording.id) === String(selectedRecordingId);
  const row = element("div", `recording-row${active ? " active" : ""}${selected ? " info-open" : ""}`);
  row.dataset.id = recording.id;
  row.title = `Play ${recording.name}`;
  row.append(element("div", "recording-icon", "▶"));
  const meta = element("div", "recording-meta");
  meta.append(
    element("div", "recording-name", recording.name),
    element("div", "recording-details", `${formatRecordingDate(recording.modifiedAt)} • ${formatRecordingDuration(recording.durationSeconds)}`)
  );
  row.append(meta);

  const info = element("div", "recording-info");
  info.hidden = !selected;
  const actions = element("div", "recording-actions");
  const play = element("button", "recording-action", "Play");
  const reveal = element("button", "recording-action", "Show in Folder");
  const remove = element("button", "recording-action recording-delete", "Delete");
  [play, reveal, remove].forEach((button) => { button.type = "button"; });
  play.addEventListener("click", (event) => {
    event.stopPropagation();
    void playRecording(recording);
  });
  reveal.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await window.wavedeck.revealRecording(recording.id);
    } catch (error) {
      nowPlaying.textContent = `Could not show recording: ${error.message}`;
    }
  });
  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!window.confirm(`Move “${recording.name}” to the Trash?`)) return;
    remove.disabled = true;
    try {
      await window.wavedeck.deleteRecording(recording.id);
      if (selectedRecordingId === recording.id) selectedRecordingId = "";
      if (currentRecordingId === recording.id) currentRecordingId = null;
      queueRender();
    } catch (error) {
      nowPlaying.textContent = `Could not delete recording: ${error.message}`;
      remove.disabled = false;
    }
  });
  actions.append(play, reveal, remove);
  info.append(actions, element("div", "recording-file-name", recording.fileName));
  row.append(info);
  row.addEventListener("click", () => {
    selectedRecordingId = recording.id;
    void playRecording(recording);
    queueRender();
  });
  return row;
}

async function renderRecordings() {
  const searchInputHadFocus = document.activeElement === recordingSearchInput;
  const recordings = await window.wavedeck.getRecordings();
  const query = String(recordingSearchQuery || "").trim().toLocaleLowerCase();
  const filtered = query
    ? recordings.filter((recording) => (`${recording.name} ${recording.fileName} ${recording.modifiedAt}`)
      .toLocaleLowerCase().includes(query))
    : recordings;
  listEl.replaceChildren();
  listEl.append(createSectionTitle("Recordings", query ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}` : "Newest first"));
  if (!filtered.length) {
    listEl.append(element("div", "placeholder", query ? "No recordings match your search." : "No recordings yet."));
  } else {
    const block = element("div", "recordings-block");
    block.append(...filtered.map(createRecordingRow));
    listEl.append(block);
  }
  if (focusRecordingSearchAfterRender || searchInputHadFocus) {
    recordingSearchInput.focus({ preventScroll: true });
    recordingSearchInput.setSelectionRange(recordingSearchQuery.length, recordingSearchQuery.length);
  }
  focusRecordingSearchAfterRender = false;
}

async function renderAll() {
  if (recordingsSectionVisible) {
    await renderRecordings();
    return;
  }
  const searchInputHadFocus = document.activeElement === stationSearchInput;
  const [stations, groupOrder, subgroupConfig, history] = await Promise.all([
    window.wavedeck.getStations(),
    window.wavedeck.getGroups(),
    window.wavedeck.getSubgroups(),
    window.wavedeck.getListeningHistory()
  ]);
  listeningHistory = history || { version: 1, stations: {} };

  const presets = stations.filter((station) => station.preset).sort(sortPresets);
  const searchActive = searchSectionVisible && Boolean(window.WaveDeckSearch.normalizeSearchText(stationSearchQuery));
  const favoritesFilterActive = proModeEnabled && favoritesOnlyVisible;
  const topFiveActive = proModeEnabled && mostPlayedSectionVisible;
  const filteredStations = stations.filter((station) => (
    (!favoritesFilterActive || station.favorite) &&
    (!searchActive || window.WaveDeckSearch.stationMatchesQuery(station, stationSearchQuery))
  ));
  const stationStats = listeningHistory.stations || {};
  const mostListened = topFiveActive && !searchActive
    ? stations
      .map((station) => ({ station, seconds: Number(stationStats[station.id]?.seconds) || 0 }))
      .filter((item) => item.seconds >= MOST_LISTENED_MINIMUM_SECONDS)
      .sort((a, b) => b.seconds - a.seconds || sortByName(a.station, b.station))
      .slice(0, 5)
    : [];
  const allGroups = buildGroupsInOrder(stations, groupOrder);
  const groups = buildGroupsInOrder(filteredStations, groupOrder);
  renderedGroupNames = allGroups.map((group) => group.name);
  renderedSubgroupKeys = allGroups.flatMap((group) => (
    [...new Set(group.items.map((station) => String(station.subgroup || "").trim()).filter(Boolean))]
      .map((subgroup) => subgroupKey(group.name, subgroup))
  ));
  const currentGroups = new Set(renderedGroupNames);
  const currentSubgroups = new Set(renderedSubgroupKeys);
  for (const name of collapsedGroups) {
    if (!currentGroups.has(name)) collapsedGroups.delete(name);
  }
  for (const key of collapsedSubgroups) {
    if (!currentSubgroups.has(key)) collapsedSubgroups.delete(key);
  }
  if (!collapseStateInitialized) {
    renderedGroupNames.forEach((name) => collapsedGroups.add(name));
    renderedSubgroupKeys.forEach((key) => collapsedSubgroups.add(key));
    collapseStateInitialized = true;
  }

  listEl.replaceChildren();
  if (presetSectionVisible && !searchActive) {
    listEl.append(createSectionTitle("Presets", presets.length ? "" : "None yet — Ctrl-click a station to add."));
    if (presets.length) {
      const block = element("div", "section-block");
      block.append(...presets.map((station) => createStationRow(station, { presetSection: true })));
      listEl.append(block);
    } else {
      listEl.append(element("div", "placeholder", "No presets yet."));
    }
  }
  if (topFiveActive && !searchActive) {
    listEl.append(createSectionTitle(
      "Your Top Five",
      mostListened.length ? "" : "Stations appear here after five minutes."
    ));
    if (mostListened.length) {
      const mostListenedBlock = element("div", "section-block most-listened-block");
      mostListenedBlock.append(...mostListened.map(({ station, seconds }) => (
        createStationRow(station, { listenedSeconds: seconds })
      )));
      listEl.append(mostListenedBlock);
    }
  }

  const allExpanded = collapsedGroups.size === 0 && collapsedSubgroups.size === 0;
  listEl.append(createSectionTitle("stations", "", searchActive ? {
    id: "searchMatchCount",
    label: `${filteredStations.length} ${filteredStations.length === 1 ? "Match" : "Matches"}`,
    disabled: true
  } : {
    id: "toggleAllGroupsBtn",
    label: allExpanded ? "Collapse All" : "Expand All"
  }));
  if (!filteredStations.length) {
    const emptyMessage = searchActive
      ? "No stations match your search."
      : (favoritesFilterActive ? "No Favorite stations yet." : "No stations yet.");
    listEl.append(element("div", "placeholder", emptyMessage));
  } else {
    const groupsEl = element("div", "groups");
    groupsEl.append(...groups.map((group) => {
      const configured = subgroupConfig?.groups?.find((entry) => (
        normalizeGroupName(entry.group).toLowerCase() === group.name.toLowerCase()
      ));
      const block = createGroupBlock(group.name, group.items, configured?.subgroups || []);
      if (searchActive) {
        const body = block.querySelector(".group-body");
        const caret = block.querySelector(".caret");
        if (body) body.hidden = false;
        if (caret) caret.textContent = "▾";
        block.querySelectorAll(".subgroup-body").forEach((subgroupBody) => { subgroupBody.hidden = false; });
        block.querySelectorAll(".subgroup-caret").forEach((caretNode) => { caretNode.textContent = "▾"; });
      }
      return block;
    }));
    listEl.append(groupsEl);
  }

  bindHandlers();
  if (searchSectionVisible && (searchInputHadFocus || focusSearchAfterRender)) {
    stationSearchInput.focus({ preventScroll: true });
    stationSearchInput.setSelectionRange(stationSearchQuery.length, stationSearchQuery.length);
  }
  focusSearchAfterRender = false;
  if (expandedStationId) {
    const row = [...listEl.querySelectorAll(".station")]
      .find((candidate) => candidate.dataset.id === expandedStationId);
    if (row) expandStationInfo(row);
    else expandedStationId = "";
  }
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(async () => {
    renderQueued = false;
    try {
      await renderAll();
    } catch (error) {
      nowPlaying.textContent = `Could not refresh stations: ${error.message}`;
    }
  });
}

function updateActiveHighlight() {
  listEl.querySelectorAll(".station").forEach((row) => {
    row.classList.toggle("active", row.dataset.id === String(currentStationId));
  });
  listEl.querySelectorAll(".recording-row").forEach((row) => {
    row.classList.toggle("active", row.dataset.id === String(currentRecordingId));
  });
}

function expandStationInfo(row) {
  expandedStationId = row.dataset.id || "";
  listEl.querySelectorAll(".station-info").forEach((info) => { info.hidden = true; });
  listEl.querySelectorAll(".station.info-open").forEach((stationRow) => stationRow.classList.remove("info-open"));
  const info = row.querySelector(".station-info");
  if (!info) return;
  row.classList.add("info-open");
  info.hidden = false;
  updateExpandedStationInfo();
}

function updateExpandedStationInfo(status = currentPlayerStatus) {
  const row = listEl.querySelector(".station.info-open");
  const bitrate = row?.querySelector(".station-info-bitrate");
  if (!row || !bitrate) return;
  if (row.dataset.id !== String(currentStationId)) {
    bitrate.textContent = "Bitrate unavailable";
  } else if (Number.isFinite(status?.bitrateKbps)) {
    bitrate.textContent = `${status.bitrateKbps} kbps`;
  } else if (status?.bitrateResolved || status?.state === "error") {
    bitrate.textContent = "Bitrate unavailable";
  } else {
    bitrate.textContent = "Detecting bitrate…";
  }
}

function clearPresetDragState() {
  listEl.querySelectorAll(".preset-row").forEach((row) => {
    row.classList.remove("dragging", "drop-before", "drop-after");
  });
  draggedPresetId = null;
}

async function savePresetOrder(orderedIds) {
  const stations = await window.wavedeck.getStations();
  const presets = stations.filter((station) => station.preset);
  const requested = orderedIds.map(String);
  const presetIds = new Set(presets.map((station) => String(station.id)));
  if (requested.length !== presets.length || requested.some((id) => !presetIds.has(id))) {
    throw new Error("The presets changed while they were being reordered.");
  }

  const orderById = new Map(requested.map((id, index) => [id, index]));
  for (const station of stations) {
    station.presetOrder = station.preset ? orderById.get(String(station.id)) : null;
  }
  await window.wavedeck.saveStations(stations);
}

function bindHandlers() {
  listEl.querySelectorAll(".station").forEach((row) => {
    const gainSlider = row.querySelector(".station-gain-slider");
    const gainReset = row.querySelector(".station-gain-reset");
    const gainControls = row.querySelector(".station-gain-control");
    gainControls?.addEventListener("click", (event) => event.stopPropagation());
    gainControls?.addEventListener("pointerdown", (event) => event.stopPropagation());
    gainSlider?.addEventListener("input", () => {
      const gainDb = Number(gainSlider.value) || 0;
      const output = row.querySelector(".station-gain-value");
      if (output) output.textContent = formatGainDb(gainDb);
      gainReset.disabled = gainDb === 0;
      clearTimeout(stationGainTimers.get(row.dataset.id));
      stationGainTimers.set(row.dataset.id, setTimeout(() => {
        stationGainTimers.delete(row.dataset.id);
        void saveStationGain(row.dataset.id, gainDb);
      }, 60));
    });
    gainSlider?.addEventListener("change", () => {
      clearTimeout(stationGainTimers.get(row.dataset.id));
      stationGainTimers.delete(row.dataset.id);
      void saveStationGain(row.dataset.id, Number(gainSlider.value) || 0);
    });
    gainReset?.addEventListener("click", () => {
      clearTimeout(stationGainTimers.get(row.dataset.id));
      stationGainTimers.delete(row.dataset.id);
      gainSlider.value = "0";
      const output = row.querySelector(".station-gain-value");
      if (output) output.textContent = formatGainDb(0);
      gainReset.disabled = true;
      void saveStationGain(row.dataset.id, 0);
    });

    row.querySelector(".favBtn").addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const stations = await window.wavedeck.getStations();
        const station = stations.find((item) => String(item.id) === row.dataset.id);
        if (!station) return;
        station.favorite = !station.favorite;
        await window.wavedeck.saveStations(stations);
      } catch (error) {
        nowPlaying.textContent = `Could not update favorite: ${error.message}`;
      }
    });

    const handle = row.querySelector(".drag-handle");
    if (handle) {
      handle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      handle.addEventListener("dragstart", (event) => {
        draggedPresetId = row.dataset.id;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedPresetId);
      });

      handle.addEventListener("dragend", clearPresetDragState);

      row.addEventListener("dragover", (event) => {
        if (!draggedPresetId || draggedPresetId === row.dataset.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        row.classList.toggle("drop-before", !after);
        row.classList.toggle("drop-after", after);
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drop-before", "drop-after");
      });

      row.addEventListener("drop", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = draggedPresetId || event.dataTransfer.getData("text/plain");
        const targetId = row.dataset.id;
        const after = row.classList.contains("drop-after");
        const orderedIds = [...listEl.querySelectorAll(".preset-row")]
          .map((presetRow) => presetRow.dataset.id)
          .filter((id) => id !== sourceId);
        const targetIndex = orderedIds.indexOf(targetId);
        if (sourceId && targetIndex >= 0) {
          orderedIds.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
        }
        clearPresetDragState();
        if (!sourceId || sourceId === targetId) return;
        try {
          await savePresetOrder(orderedIds);
        } catch (error) {
          nowPlaying.textContent = `Could not reorder presets: ${error.message}`;
          queueRender();
        }
      });
    }

    row.addEventListener("pointerdown", (event) => {
      if (event.ctrlKey || event.shiftKey) event.preventDefault();
    });

    row.addEventListener("click", async (event) => {
      if (event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        try {
          const stations = await window.wavedeck.getStations();
          const station = stations.find((item) => String(item.id) === row.dataset.id);
          if (!station) return;
          station.hasPreRoll = !station.hasPreRoll;
          await window.wavedeck.saveStations(stations);
        } catch (error) {
          nowPlaying.textContent = `Could not update pre-roll marker: ${error.message}`;
        }
        return;
      }
      if (event.ctrlKey) {
        event.preventDefault();
        try {
          const stations = await window.wavedeck.getStations();
          const station = stations.find((item) => String(item.id) === row.dataset.id);
          if (!station) return;
          setPresetState(stations, station, !station.preset);
          await window.wavedeck.saveStations(stations);
        } catch (error) {
          nowPlaying.textContent = `Could not update preset: ${error.message}`;
        }
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        try {
          await window.wavedeck.editStation(row.dataset.id);
        } catch (error) {
          nowPlaying.textContent = `Could not edit station: ${error.message}`;
        }
        return;
      }
      currentStationId = row.dataset.id;
      headerStationName.textContent = row.dataset.name || "WaveDeck";
      nowPlaying.textContent = "Connecting…";
      currentPlayerStatus = { state: "connecting", bitrateKbps: null, bitrateResolved: false };
      updateActiveHighlight();
      expandStationInfo(row);

      try {
        await window.wavedeck.playStation(row.dataset.id);
      } catch (error) {
        currentStationId = null;
        updateActiveHighlight();
        nowPlaying.textContent = `Could not play station: ${error.message}`;
      }
    });
  });

  listEl.querySelectorAll(".group-header").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.WaveDeckSearch.normalizeSearchText(stationSearchQuery)) return;
      const groupName = button.dataset.group || "Other";
      if (collapsedGroups.has(groupName)) collapsedGroups.delete(groupName);
      else collapsedGroups.add(groupName);

      const body = button.closest(".group")?.querySelector(".group-body");
      const caret = button.querySelector(".caret");
      const collapsed = collapsedGroups.has(groupName);
      if (body) body.hidden = collapsed;
      if (caret) caret.textContent = collapsed ? "▸" : "▾";
    });
  });

  listEl.querySelectorAll(".subgroup-header").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.WaveDeckSearch.normalizeSearchText(stationSearchQuery)) return;
      const key = subgroupKey(button.dataset.group || "Other", button.dataset.subgroup || "");
      if (collapsedSubgroups.has(key)) collapsedSubgroups.delete(key);
      else collapsedSubgroups.add(key);
      const body = button.closest(".subgroup")?.querySelector(".subgroup-body");
      const caret = button.querySelector(".subgroup-caret");
      const collapsed = collapsedSubgroups.has(key);
      if (body) body.hidden = collapsed;
      if (caret) caret.textContent = collapsed ? "▸" : "▾";
    });
  });

  document.getElementById("toggleAllGroupsBtn")?.addEventListener("click", () => {
    const allExpanded = collapsedGroups.size === 0 && collapsedSubgroups.size === 0;
    collapsedGroups.clear();
    collapsedSubgroups.clear();
    if (allExpanded) {
      renderedGroupNames.forEach((name) => collapsedGroups.add(name));
      renderedSubgroupKeys.forEach((key) => collapsedSubgroups.add(key));
    }
    queueRender();
  });
}

async function runTransport(button, action, failureLabel) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    nowPlaying.textContent = `${failureLabel}: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

previousPresetBtn.addEventListener("click", () => runTransport(
  previousPresetBtn,
  () => window.wavedeck.previousPreset(),
  "Previous Preset failed"
));

playPauseBtn.addEventListener("click", () => runTransport(
  playPauseBtn,
  () => window.wavedeck.playPause(),
  "Playback failed"
));

recordBtn.addEventListener("click", async () => {
  recordBtn.disabled = true;
  try {
    setRecordingUi(await window.wavedeck.toggleRecording());
  } catch (error) {
    nowPlaying.textContent = `Recording failed: ${error.message}`;
  } finally {
    setRecordingUi(recordingState);
  }
});

nextPresetBtn.addEventListener("click", () => runTransport(
  nextPresetBtn,
  () => window.wavedeck.nextPreset(),
  "Next Preset failed"
));

muteBtn.addEventListener("click", async () => {
  muteBtn.disabled = true;
  try {
    setMuteUi(await window.wavedeck.toggleMute());
  } catch (error) {
    nowPlaying.textContent = `Mute failed: ${error.message}`;
  } finally {
    muteBtn.disabled = false;
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await window.wavedeck.stop();
    currentStationId = null;
    currentRecordingId = null;
    headerStationName.textContent = "WaveDeck";
    nowPlaying.textContent = "Stopped";
    updateActiveHighlight();
  } catch (error) {
    nowPlaying.textContent = `Stop failed: ${error.message}`;
  }
});

volumeSlider.addEventListener("input", () => {
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(async () => {
    try {
      await window.wavedeck.setVolume(Number(volumeSlider.value));
    } catch (error) {
      nowPlaying.textContent = `Volume failed: ${error.message}`;
    }
  }, 60);
});

openSettingsBtn.addEventListener("click", async () => {
  try {
    await window.wavedeck.openSettings();
  } catch (error) {
    nowPlaying.textContent = `Could not open settings: ${error.message}`;
  }
});

searchSectionToggleBtn.addEventListener("click", async () => {
  searchSectionToggleBtn.disabled = true;
  const showSearch = recordingsSectionVisible || !searchSectionVisible;
  if (showSearch) focusSearchAfterRender = true;
  try {
    if (recordingsSectionVisible) setRecordingsSectionVisible(false);
    setSectionVisibilityUi(await window.wavedeck.setSectionVisibility({
      search: showSearch
    }));
  } catch (error) {
    focusSearchAfterRender = false;
    nowPlaying.textContent = `Could not toggle Search: ${error.message}`;
  } finally {
    searchSectionToggleBtn.disabled = false;
  }
});

presetSectionToggleBtn.addEventListener("click", async () => {
  presetSectionToggleBtn.disabled = true;
  const showPresets = recordingsSectionVisible || !presetSectionVisible;
  try {
    if (recordingsSectionVisible) setRecordingsSectionVisible(false);
    setSectionVisibilityUi(await window.wavedeck.setSectionVisibility({
      presets: showPresets
    }));
  } catch (error) {
    nowPlaying.textContent = `Could not toggle Presets: ${error.message}`;
  } finally {
    presetSectionToggleBtn.disabled = false;
  }
});

favoritesOnlyToggleBtn.addEventListener("click", async () => {
  favoritesOnlyToggleBtn.disabled = true;
  const showFavoritesOnly = recordingsSectionVisible || !favoritesOnlyVisible;
  try {
    if (recordingsSectionVisible) setRecordingsSectionVisible(false);
    setSectionVisibilityUi(await window.wavedeck.setSectionVisibility({
      favoritesOnly: showFavoritesOnly
    }));
  } catch (error) {
    nowPlaying.textContent = `Could not toggle Favorites: ${error.message}`;
  } finally {
    favoritesOnlyToggleBtn.disabled = false;
  }
});

mostPlayedSectionToggleBtn.addEventListener("click", async () => {
  mostPlayedSectionToggleBtn.disabled = true;
  const showMostPlayed = recordingsSectionVisible || !mostPlayedSectionVisible;
  try {
    if (recordingsSectionVisible) setRecordingsSectionVisible(false);
    setSectionVisibilityUi(await window.wavedeck.setSectionVisibility({
      mostPlayed: showMostPlayed
    }));
  } catch (error) {
    nowPlaying.textContent = `Could not toggle Your Top Five: ${error.message}`;
  } finally {
    mostPlayedSectionToggleBtn.disabled = false;
  }
});

recordingsSectionToggleBtn.addEventListener("click", () => {
  if (recordingsSectionVisible) {
    setRecordingsSectionVisible(false);
    return;
  }
  focusRecordingSearchAfterRender = true;
  setRecordingsSectionVisible(true);
});

sidebarModeBtn.addEventListener("click", async () => {
  sidebarModeBtn.disabled = true;
  try {
    await saveNotepadNow();
    setSidebarUi(await window.wavedeck.toggleSidebar());
  } catch (error) {
    nowPlaying.textContent = `Sidebar Mode unavailable: ${error.message}`;
  } finally {
    try {
      setSidebarUi(await window.wavedeck.getSidebarState());
    } catch {
      sidebarModeBtn.disabled = false;
    }
  }
});

notepadToggleBtn.addEventListener("click", async () => {
  if (!sidebarModeEnabled) return;
  if (notepadOpen) {
    await saveNotepadNow();
    setNotepadOpen(false);
  } else {
    setNotepadOpen(true, { focus: true });
  }
});

notepadText.addEventListener("input", () => {
  notepadDirty = true;
  clearTimeout(notepadSaveTimer);
  notepadSaveTimer = setTimeout(() => void saveNotepadNow(), 350);
});

stationSearchInput.addEventListener("input", () => {
  stationSearchQuery = stationSearchInput.value;
  clearStationSearchBtn.hidden = !stationSearchQuery;
  clearTimeout(searchRenderTimer);
  searchRenderTimer = setTimeout(() => {
    focusSearchAfterRender = true;
    queueRender();
  }, 75);
});

stationSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !stationSearchQuery) return;
  event.preventDefault();
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  stationSearchQuery = "";
  stationSearchInput.value = "";
  clearStationSearchBtn.hidden = true;
  focusSearchAfterRender = true;
  queueRender();
});

clearStationSearchBtn.addEventListener("click", () => {
  clearTimeout(searchRenderTimer);
  searchRenderTimer = null;
  stationSearchQuery = "";
  stationSearchInput.value = "";
  clearStationSearchBtn.hidden = true;
  focusSearchAfterRender = true;
  queueRender();
});

recordingSearchInput.addEventListener("input", () => {
  recordingSearchQuery = recordingSearchInput.value;
  clearRecordingSearchBtn.hidden = !recordingSearchQuery;
  clearTimeout(recordingSearchRenderTimer);
  recordingSearchRenderTimer = setTimeout(() => {
    focusRecordingSearchAfterRender = true;
    queueRender();
  }, 75);
});

recordingSearchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !recordingSearchQuery) return;
  event.preventDefault();
  recordingSearchQuery = "";
  recordingSearchInput.value = "";
  clearRecordingSearchBtn.hidden = true;
  focusRecordingSearchAfterRender = true;
  queueRender();
});

clearRecordingSearchBtn.addEventListener("click", () => {
  recordingSearchQuery = "";
  recordingSearchInput.value = "";
  clearRecordingSearchBtn.hidden = true;
  focusRecordingSearchAfterRender = true;
  queueRender();
});

window.addEventListener("beforeunload", () => {
  if (notepadDirty) window.wavedeck.saveNotepadImmediate(notepadText.value);
});

window.wavedeck.onMetadata((metadata) => {
  if (metadata) nowPlaying.textContent = metadata;
});

window.wavedeck.onStationChanged((station) => {
  currentStationId = station?.id || null;
  if (station) currentRecordingId = null;
  headerStationName.textContent = station?.name || "WaveDeck";
  nowPlaying.textContent = station ? "Connecting…" : "Now Playing: (ready)";
  updateActiveHighlight();
});

window.wavedeck.onPlayerStatus((status) => {
  currentPlayerStatus = status;
  setPlayPauseUi(status);
  if (typeof status?.muted === "boolean") setMuteUi(status.muted);
  if (Number.isFinite(status?.volume) && document.activeElement !== volumeSlider) {
    volumeSlider.value = String(Math.round(status.volume));
  }
  if (status?.mediaState === "paused") nowPlaying.textContent = "Paused";
  if (status?.currentRecording && status?.mediaState !== "stopped") {
    currentStationId = null;
    currentRecordingId = status.currentRecording.id;
    headerStationName.textContent = status.currentRecording.name || "WaveDeck Recording";
    updateActiveHighlight();
  }
  if (status?.mediaState === "stopped") {
    currentStationId = null;
    currentRecordingId = null;
    headerStationName.textContent = "WaveDeck";
    updateActiveHighlight();
    if (status?.state !== "error") nowPlaying.textContent = "Stopped";
  }
  if (status?.state === "error") nowPlaying.textContent = status.message;
  if (status?.mediaState === "playing" && status?.state === "connecting") {
    nowPlaying.textContent = "Connecting…";
  }
  updateExpandedStationInfo(status);
});

window.wavedeck.onSidebarState(setSidebarUi);
window.wavedeck.onListeningHistoryChanged((history) => {
  listeningHistory = history || { version: 1, stations: {} };
  if (mostPlayedSectionVisible) queueRender();
});

window.wavedeck.onSectionVisibilityChanged(setSectionVisibilityUi);
window.wavedeck.onUiPreferencesChanged(setProModeUi);
window.wavedeck.onRecordingState((state) => {
  setRecordingUi(state);
  if (state?.error) nowPlaying.textContent = state.error;
});
window.wavedeck.onRecordingsChanged(() => {
  if (recordingsSectionVisible) queueRender();
});

window.wavedeck.onStationsChanged(queueRender);
window.wavedeck.onGroupsChanged(queueRender);
window.wavedeck.onSubgroupsChanged(queueRender);
window.wavedeck.onWarning((warning) => {
  if (warning && !/media[- ]key/i.test(warning)) nowPlaying.textContent = warning;
});

(async function initialize() {
  nowPlaying.textContent = "Warming up the airwaves...";
  setMuteUi(false);
  await renderAll();
  try {
    const [status, sidebarState, sectionVisibility, savedNotepad, preferences, savedRecordingState] = await Promise.all([
      window.wavedeck.getPlayerStatus(),
      window.wavedeck.getSidebarState(),
      window.wavedeck.getSectionVisibility(),
      window.wavedeck.getNotepad(),
      window.wavedeck.getUiPreferences(),
      window.wavedeck.getRecordingState()
    ]);
    currentPlayerStatus = status;
    notepadText.value = savedNotepad || "";
    notepadDirty = false;
    setNotepadOpen(false);
    setProModeUi(preferences);
    setSidebarUi(sidebarState);
    setSectionVisibilityUi(sectionVisibility);
    setRecordingUi(savedRecordingState);
    setPlayPauseUi(status);
    if (typeof status?.muted === "boolean") setMuteUi(status.muted);
    if (Number.isFinite(status?.volume)) volumeSlider.value = String(Math.round(status.volume));
    if (status?.currentStation && status?.mediaState !== "stopped") {
      currentStationId = status.currentStation.id;
      headerStationName.textContent = status.currentStation.name || "WaveDeck";
      updateActiveHighlight();
    } else if (status?.currentRecording && status?.mediaState !== "stopped") {
      currentRecordingId = status.currentRecording.id;
      headerStationName.textContent = status.currentRecording.name || "WaveDeck Recording";
      updateActiveHighlight();
    }
    if (status?.state === "error") nowPlaying.textContent = status.message;
    else if (status?.mediaState === "paused") nowPlaying.textContent = "Paused";
    else if (status?.mediaState === "playing") {
      nowPlaying.textContent = status?.state === "connecting" ? "Connecting…" : (status.message || "Playing");
    } else nowPlaying.textContent = "Warming up the airwaves...";
  } catch (error) {
    nowPlaying.textContent = `Playback unavailable: ${error.message}`;
  }
})();
