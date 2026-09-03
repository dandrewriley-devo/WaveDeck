const headerStationName = document.querySelector(".station-name");
const nowPlaying = document.getElementById("nowPlaying");
const muteBtn = document.getElementById("muteBtn");
const muteIcon = document.getElementById("muteIcon");
const stopBtn = document.getElementById("stopBtn");
const volumeSlider = document.getElementById("volSlider");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const sidebarModeBtn = document.getElementById("sidebarModeBtn");
const notepadToggleBtn = document.getElementById("notepadToggleBtn");
const notepadPanel = document.getElementById("notepadPanel");
const notepadText = document.getElementById("notepadText");
const appVersion = document.getElementById("appVersion");
const listEl = document.querySelector(".list");

let currentStationId = null;
let isMuted = false;
let renderQueued = false;
let volumeTimer = null;
let notepadSaveTimer = null;
let notepadDirty = false;
let notepadOpen = false;
let sidebarModeEnabled = false;
let draggedFavoriteId = null;
let listeningHistory = { version: 1, stations: {} };
let currentPlayerStatus = null;
let expandedStationId = "";
const collapsedGroups = new Set();
const collapsedSubgroups = new Set();
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

function favoriteRank(station) {
  const raw = station?.favoriteOrder;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sortFavorites(a, b) {
  const aRank = favoriteRank(a);
  const bRank = favoriteRank(b);
  if (aRank !== null && bRank !== null && aRank !== bRank) return aRank - bRank;
  if (aRank !== null && bRank === null) return -1;
  if (aRank === null && bRank !== null) return 1;
  return sortByName(a, b);
}

function normalizeFavoriteOrder(stations) {
  const favorites = stations.filter((station) => station.favorite).sort(sortFavorites);
  favorites.forEach((station, index) => { station.favoriteOrder = index; });
  stations.filter((station) => !station.favorite).forEach((station) => { station.favoriteOrder = null; });
  return favorites;
}

function setFavoriteState(stations, station, favorite) {
  const next = Boolean(favorite);
  if (next === Boolean(station.favorite)) return;
  if (next) {
    const favorites = normalizeFavoriteOrder(stations);
    station.favorite = true;
    station.favoriteOrder = favorites.length;
  } else {
    station.favorite = false;
    station.favoriteOrder = null;
    normalizeFavoriteOrder(stations);
  }
}

function setMuteUi(muted) {
  isMuted = Boolean(muted);
  muteIcon.innerHTML = isMuted ? ICON_SPEAKER_X : ICON_SPEAKER_WAVE;
  muteBtn.title = isMuted ? "Unmute" : "Mute";
  muteBtn.setAttribute("aria-label", isMuted ? "Unmute" : "Mute");
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
  notepadToggleBtn.hidden = !enabled;
  notepadToggleBtn.disabled = !enabled;
  if (!enabled) setNotepadOpen(false);
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

function createStationRow(station, { favoriteSection = false, listenedSeconds = 0 } = {}) {
  const row = element("div", `station${String(station.id) === String(currentStationId) ? " active" : ""}`);
  row.dataset.id = String(station.id ?? "");
  row.dataset.url = String(station.url ?? "");
  row.dataset.name = String(station.name ?? "");
  row.title = "Click to play • Shift-click to edit";

  const favorite = element("button", `favBtn${station.noPreRoll ? " no-preroll" : ""}`, station.favorite ? "★" : "☆");
  favorite.type = "button";
  favorite.title = station.noPreRoll ? "No pre-roll • Toggle favorite" : "Toggle favorite";
  favorite.setAttribute("aria-label", `Toggle favorite for ${station.name}`);

  const meta = element("div", "meta");
  meta.append(element("div", "name", station.name));
  if (listenedSeconds > 0) {
    meta.append(element("div", "listening-time", formatListeningTime(listenedSeconds)));
  }
  if (favoriteSection) {
    row.classList.add("favorite-row");
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
  row.append(info);
  return row;
}

function createSectionTitle(title, subtitle = "") {
  const section = element("div", "section-title");
  section.append(element("div", "section-main", title));
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

async function renderAll() {
  const [stations, groupOrder, subgroupConfig, history] = await Promise.all([
    window.wavedeck.getStations(),
    window.wavedeck.getGroups(),
    window.wavedeck.getSubgroups(),
    window.wavedeck.getListeningHistory()
  ]);
  listeningHistory = history || { version: 1, stations: {} };

  const favorites = stations.filter((station) => station.favorite).sort(sortFavorites);
  const stationStats = listeningHistory.stations || {};
  const mostListened = sidebarModeEnabled
    ? stations
      .map((station) => ({ station, seconds: Number(stationStats[station.id]?.seconds) || 0 }))
      .filter((item) => item.seconds >= MOST_LISTENED_MINIMUM_SECONDS)
      .sort((a, b) => b.seconds - a.seconds || sortByName(a.station, b.station))
      .slice(0, 5)
    : [];
  const groups = buildGroupsInOrder(
    stations.filter((station) => !station.favorite),
    groupOrder
  );

  listEl.replaceChildren();
  if (sidebarModeEnabled && mostListened.length) {
    listEl.append(createSectionTitle("Most Played"));
    const mostListenedBlock = element("div", "section-block most-listened-block");
    mostListenedBlock.append(...mostListened.map(({ station, seconds }) => (
      createStationRow(station, { listenedSeconds: seconds })
    )));
    listEl.append(mostListenedBlock);
  }
  listEl.append(createSectionTitle("Favorites", favorites.length ? "" : "None yet — hit ☆ to add."));

  if (favorites.length) {
    const block = element("div", "section-block");
    block.append(...favorites.map((station) => createStationRow(station, { favoriteSection: true })));
    listEl.append(block);
  } else {
    listEl.append(element("div", "placeholder", "No favorites yet."));
  }

  listEl.append(createSectionTitle("stations"));
  if (!stations.length) {
    listEl.append(element("div", "placeholder", "No stations yet."));
  } else {
    const groupsEl = element("div", "groups");
    groupsEl.append(...groups.map((group) => {
      const configured = subgroupConfig?.groups?.find((entry) => (
        normalizeGroupName(entry.group).toLowerCase() === group.name.toLowerCase()
      ));
      return createGroupBlock(group.name, group.items, configured?.subgroups || []);
    }));
    listEl.append(groupsEl);
  }

  bindHandlers();
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

function clearFavoriteDragState() {
  listEl.querySelectorAll(".favorite-row").forEach((row) => {
    row.classList.remove("dragging", "drop-before", "drop-after");
  });
  draggedFavoriteId = null;
}

async function saveFavoriteOrder(orderedIds) {
  const stations = await window.wavedeck.getStations();
  const favorites = stations.filter((station) => station.favorite);
  const requested = orderedIds.map(String);
  const favoriteIds = new Set(favorites.map((station) => String(station.id)));
  if (requested.length !== favorites.length || requested.some((id) => !favoriteIds.has(id))) {
    throw new Error("The favorites changed while they were being reordered.");
  }

  const orderById = new Map(requested.map((id, index) => [id, index]));
  for (const station of stations) {
    station.favoriteOrder = station.favorite ? orderById.get(String(station.id)) : null;
  }
  await window.wavedeck.saveStations(stations);
}

function bindHandlers() {
  listEl.querySelectorAll(".station").forEach((row) => {
    row.querySelector(".favBtn").addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const stations = await window.wavedeck.getStations();
        const station = stations.find((item) => String(item.id) === row.dataset.id);
        if (!station) return;
        setFavoriteState(stations, station, !station.favorite);
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
        draggedFavoriteId = row.dataset.id;
        row.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedFavoriteId);
      });

      handle.addEventListener("dragend", clearFavoriteDragState);

      row.addEventListener("dragover", (event) => {
        if (!draggedFavoriteId || draggedFavoriteId === row.dataset.id) return;
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
        const sourceId = draggedFavoriteId || event.dataTransfer.getData("text/plain");
        const targetId = row.dataset.id;
        const after = row.classList.contains("drop-after");
        const orderedIds = [...listEl.querySelectorAll(".favorite-row")]
          .map((favoriteRow) => favoriteRow.dataset.id)
          .filter((id) => id !== sourceId);
        const targetIndex = orderedIds.indexOf(targetId);
        if (sourceId && targetIndex >= 0) {
          orderedIds.splice(targetIndex + (after ? 1 : 0), 0, sourceId);
        }
        clearFavoriteDragState();
        if (!sourceId || sourceId === targetId) return;
        try {
          await saveFavoriteOrder(orderedIds);
        } catch (error) {
          nowPlaying.textContent = `Could not reorder favorites: ${error.message}`;
          queueRender();
        }
      });
    }

    row.addEventListener("click", async (event) => {
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
}

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

window.addEventListener("beforeunload", () => {
  if (notepadDirty) window.wavedeck.saveNotepadImmediate(notepadText.value);
});

window.wavedeck.onMetadata((metadata) => {
  if (metadata) nowPlaying.textContent = metadata;
});

window.wavedeck.onStationChanged((station) => {
  currentStationId = station?.id || null;
  headerStationName.textContent = station?.name || "WaveDeck";
  nowPlaying.textContent = station ? "Connecting…" : "Now Playing: (ready)";
  updateActiveHighlight();
});

window.wavedeck.onPlayerStatus((status) => {
  currentPlayerStatus = status;
  if (typeof status?.muted === "boolean") setMuteUi(status.muted);
  if (Number.isFinite(status?.volume) && document.activeElement !== volumeSlider) {
    volumeSlider.value = String(Math.round(status.volume));
  }
  if (status?.mediaState === "paused") nowPlaying.textContent = "Paused";
  if (status?.mediaState === "stopped") {
    currentStationId = null;
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
  if (sidebarModeEnabled) queueRender();
});

window.wavedeck.onStationsChanged(queueRender);
window.wavedeck.onGroupsChanged(queueRender);
window.wavedeck.onSubgroupsChanged(queueRender);
window.wavedeck.onWarning((warning) => {
  if (warning) nowPlaying.textContent = warning;
});

(async function initialize() {
  nowPlaying.textContent = "Starting playback engine…";
  setMuteUi(false);
  await renderAll();
  try {
    const [status, sidebarState, savedNotepad, info] = await Promise.all([
      window.wavedeck.getPlayerStatus(),
      window.wavedeck.getSidebarState(),
      window.wavedeck.getNotepad(),
      window.wavedeck.getAppInfo()
    ]);
    currentPlayerStatus = status;
    appVersion.textContent = `v${info.version}`;
    notepadText.value = savedNotepad || "";
    notepadDirty = false;
    setNotepadOpen(false);
    setSidebarUi(sidebarState);
    if (typeof status?.muted === "boolean") setMuteUi(status.muted);
    if (Number.isFinite(status?.volume)) volumeSlider.value = String(Math.round(status.volume));
    if (status?.currentStation && status?.mediaState !== "stopped") {
      currentStationId = status.currentStation.id;
      headerStationName.textContent = status.currentStation.name || "WaveDeck";
      updateActiveHighlight();
    }
    if (status?.state === "error") nowPlaying.textContent = status.message;
    else if (status?.mediaState === "paused") nowPlaying.textContent = "Paused";
    else if (status?.mediaState === "playing") {
      nowPlaying.textContent = status?.state === "connecting" ? "Connecting…" : (status.message || "Playing");
    } else nowPlaying.textContent = "Now Playing: (ready)";
  } catch (error) {
    nowPlaying.textContent = `Playback unavailable: ${error.message}`;
  }
})();
