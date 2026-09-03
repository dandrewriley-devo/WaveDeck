const tabs = document.querySelectorAll(".tab");
const panels = new Map([
  ["stations", document.getElementById("tab-stations")],
  ["groups", document.getElementById("tab-groups")],
  ["importexport", document.getElementById("tab-importexport")],
  ["launcher", document.getElementById("tab-launcher")],
  ["about", document.getElementById("tab-about")]
]);

const statusStations = document.getElementById("status");
const statusGroups = document.getElementById("statusGroups");
const statusImportExport = document.getElementById("statusImportExport");
const stationSearch = document.getElementById("stationSearch");
const stationGroupFilter = document.getElementById("stationGroupFilter");
const newStationBtn = document.getElementById("newStationBtn");
const stationsTbody = document.getElementById("stationsTbody");
const stationEditor = document.getElementById("stationEditor");
const stationFormTitle = document.getElementById("stationFormTitle");
const stationForm = document.getElementById("stationForm");
const stationName = document.getElementById("st_name");
const stationUrl = document.getElementById("st_url");
const stationGroup = document.getElementById("st_group");
const stationSubgroup = document.getElementById("st_subgroup");
const stationCountry = document.getElementById("st_country");
const stationDescription = document.getElementById("st_description");
const stationFavorite = document.getElementById("st_favorite");
const stationNoPreRoll = document.getElementById("st_no_preroll");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const testUrlBtn = document.getElementById("testUrlBtn");
const testUrlStatus = document.getElementById("testUrlStatus");
const newGroupInput = document.getElementById("newGroupInput");
const addGroupBtn = document.getElementById("addGroupBtn");
const groupsList = document.getElementById("groupsList");
const exportStationsBtn = document.getElementById("exportStationsBtn");
const importStationsBtn = document.getElementById("importStationsBtn");
const launcherState = document.getElementById("launcherState");
const statusLauncher = document.getElementById("statusLauncher");
const installLauncherBtn = document.getElementById("installLauncherBtn");
const removeLauncherBtn = document.getElementById("removeLauncherBtn");
const resetListeningBtn = document.getElementById("resetListeningBtn");

let stations = [];
let groups = [];
let subgroupConfig = { version: 1, groups: [] };
let listeningHistory = { version: 1, stations: {} };
let editingId = null;
let editorVisible = false;
let reloadQueued = false;
let initialized = false;
let pendingEditId = "";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function lowerKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeGroupName(value) {
  return String(value ?? "").trim() || "Other";
}

function ensureOtherLast(values) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const name = normalizeGroupName(raw);
    const key = lowerKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (key !== "other") result.push(name);
  }
  result.push("Other");
  return result;
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
  return String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { sensitivity: "base" });
}

function normalizeFavoriteOrder(values) {
  const favorites = values.filter((station) => station.favorite).sort(sortFavorites);
  favorites.forEach((station, index) => { station.favoriteOrder = index; });
  values.filter((station) => !station.favorite).forEach((station) => { station.favoriteOrder = null; });
  return favorites;
}

function setFavoriteState(values, station, favorite) {
  const next = Boolean(favorite);
  if (next === Boolean(station.favorite)) return;
  if (next) {
    const favorites = normalizeFavoriteOrder(values);
    station.favorite = true;
    station.favoriteOrder = favorites.length;
  } else {
    station.favorite = false;
    station.favoriteOrder = null;
    normalizeFavoriteOrder(values);
  }
}

function createId() {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function setStatus(node, message = "", success = true) {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("status-error", Boolean(message) && !success);
}

function showTab(name) {
  const selected = panels.has(name) ? name : "stations";
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === selected));
  for (const [panelName, panel] of panels) panel.classList.toggle("hidden", panelName !== selected);
}

function renderLauncherStatus(status) {
  const available = status?.available === true;
  const installed = status?.installed === true;
  const managed = status?.managed === true;
  const current = status?.current === true;

  if (!available) {
    launcherState.textContent = "Launcher setup is available when Settings is opened from the portable Linux AppImage.";
  } else if (installed && current) {
    launcherState.textContent = "WaveDeck is registered in the Applications menu for this AppImage.";
  } else if (installed && managed) {
    launcherState.textContent = "A WaveDeck launcher exists but points to another copy. Update it to use this AppImage.";
  } else if (installed) {
    launcherState.textContent = "A custom WaveDeck launcher already exists. WaveDeck will leave it untouched.";
  } else {
    launcherState.textContent = "No WaveDeck application launcher is installed yet.";
  }

  installLauncherBtn.disabled = !available || (installed && !managed);
  installLauncherBtn.textContent = installed && managed
    ? "Update WaveDeck Applications Menu Entry"
    : "Add WaveDeck to Applications Menu";
  removeLauncherBtn.disabled = !installed || !managed;
}

async function loadLauncherStatus() {
  try {
    renderLauncherStatus(await window.wavedeck.getLauncherStatus());
  } catch (error) {
    launcherState.textContent = "WaveDeck could not check the application launcher.";
    installLauncherBtn.disabled = true;
    removeLauncherBtn.disabled = true;
    setStatus(statusLauncher, `Launcher check failed: ${error.message}`, false);
  }
}

tabs.forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

async function loadData() {
  const [loadedStations, loadedGroups, loadedSubgroups, loadedHistory] = await Promise.all([
    window.wavedeck.getStations(),
    window.wavedeck.getGroups(),
    window.wavedeck.getSubgroups(),
    window.wavedeck.getListeningHistory()
  ]);
  stations = Array.isArray(loadedStations) ? loadedStations : [];
  groups = ensureOtherLast(loadedGroups);
  subgroupConfig = loadedSubgroups && Array.isArray(loadedSubgroups.groups)
    ? loadedSubgroups
    : { version: 1, groups: [] };
  listeningHistory = loadedHistory || { version: 1, stations: {} };
}

function rebuildGroupControls() {
  stationGroup.replaceChildren();
  stationGroupFilter.replaceChildren();

  const allGroups = element("option", "", "All groups");
  allGroups.value = "";
  stationGroupFilter.append(allGroups);

  for (const group of groups) {
    const editorOption = element("option", "", group);
    editorOption.value = group;
    stationGroup.append(editorOption);

    const filterOption = element("option", "", group);
    filterOption.value = group;
    stationGroupFilter.append(filterOption);
  }
  rebuildSubgroupControl();
}

function getSubgroupsFor(groupName) {
  const key = lowerKey(groupName);
  return subgroupConfig.groups.find((entry) => lowerKey(entry.group) === key)?.subgroups || [];
}

function rebuildSubgroupControl(preferredValue = stationSubgroup.value) {
  const names = getSubgroupsFor(stationGroup.value);
  stationSubgroup.replaceChildren();
  const none = element("option", "", "No subgroup");
  none.value = "";
  stationSubgroup.append(none);
  for (const name of names) {
    const option = element("option", "", name);
    option.value = name;
    stationSubgroup.append(option);
  }
  stationSubgroup.value = names.includes(preferredValue) ? preferredValue : "";
}

function getFilteredStations() {
  const query = stationSearch.value.trim().toLowerCase();
  const groupFilter = stationGroupFilter.value;
  return stations
    .filter((station) => !groupFilter || normalizeGroupName(station.group) === groupFilter)
    .filter((station) => !query || [
      station.name,
      station.group,
      station.subgroup,
      station.country,
      station.description,
      station.url
    ]
      .join(" ")
      .toLowerCase()
      .includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function miniButton(label, className, handler) {
  const button = element("button", `mini ${className || ""}`.trim(), label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function formatListeningTotal(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!value) return "—";
  if (value < 60) return "<1m";
  const totalMinutes = Math.floor(value / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function appendEditorRow(afterRow = null) {
  const editorRow = element("tr", "station-editor-row");
  const editorCell = element("td");
  editorCell.colSpan = 6;
  stationEditor.hidden = false;
  editorCell.append(stationEditor);
  editorRow.append(editorCell);
  if (afterRow) afterRow.after(editorRow);
  else stationsTbody.prepend(editorRow);
}

function renderStationsTable() {
  stationsTbody.replaceChildren();
  const filtered = getFilteredStations();

  if (!filtered.length) {
    const row = element("tr");
    const cell = element("td", "muted", "No stations match.");
    cell.colSpan = 6;
    row.append(cell);
    stationsTbody.append(row);
    if (editorVisible && !editingId) appendEditorRow();
    return;
  }

  if (editorVisible && !editingId) appendEditorRow();

  for (const station of filtered) {
    const row = element("tr");
    const favoriteCell = element("td");
    const favoriteButton = miniButton(station.favorite ? "★" : "☆", "fav-star", async () => {
      setFavoriteState(stations, station, !station.favorite);
      await saveStations();
    });
    favoriteButton.classList.toggle("no-preroll", Boolean(station.noPreRoll));
    favoriteButton.title = `Toggle favorite for ${station.name}`;
    favoriteCell.append(favoriteButton);

    const nameCell = element("td");
    nameCell.append(element("b", "", station.name));
    const groupCell = element("td", "", normalizeGroupName(station.group));
    if (station.subgroup) groupCell.append(element("div", "table-subgroup", station.subgroup));
    const countryCell = element("td", "", station.country || "");
    const listenedCell = element(
      "td",
      "listened-total",
      formatListeningTotal(listeningHistory.stations?.[station.id]?.seconds)
    );
    const actionsCell = element("td");
    actionsCell.append(
      miniButton("Edit", "", () => startEdit(station.id)),
      miniButton("Delete", "danger", () => deleteStation(station.id))
    );
    row.dataset.stationId = String(station.id);
    row.append(favoriteCell, nameCell, groupCell, countryCell, listenedCell, actionsCell);
    stationsTbody.append(row);
    if (editorVisible && editingId === station.id) appendEditorRow(row);
  }
}

function renderGroups() {
  groups = ensureOtherLast(groups);
  groupsList.replaceChildren();

  groups.forEach((group, index) => {
    const isOther = lowerKey(group) === "other";
    const card = element("div", "group-card");
    const row = element("div", "group-row");
    row.append(element("div", "group-name", group));

    const actions = element("div", "group-actions");
    const up = miniButton("Up", "", () => moveGroup(index, -1));
    const down = miniButton("Down", "", () => moveGroup(index, 1));
    const remove = miniButton("Delete", "danger", () => deleteGroup(group));
    up.disabled = index === 0 || isOther;
    down.disabled = isOther || index >= groups.length - 2;
    remove.disabled = isOther;
    actions.append(up, down, remove);
    row.append(actions);
    card.append(row);

    const subgroupArea = element("div", "subgroup-manager");
    subgroupArea.append(element("div", "subgroup-manager-title", "Subgroups"));
    const names = getSubgroupsFor(group);
    if (!names.length) subgroupArea.append(element("div", "muted subgroup-empty", "No subgroups."));
    names.forEach((name, subgroupIndex) => {
      const subgroupRow = element("div", "subgroup-row");
      subgroupRow.append(element("span", "subgroup-label", name));
      const subgroupActions = element("div", "group-actions");
      const upSubgroup = miniButton("Up", "", () => moveSubgroup(group, subgroupIndex, -1));
      const downSubgroup = miniButton("Down", "", () => moveSubgroup(group, subgroupIndex, 1));
      upSubgroup.disabled = subgroupIndex === 0;
      downSubgroup.disabled = subgroupIndex === names.length - 1;
      subgroupActions.append(
        upSubgroup,
        downSubgroup,
        miniButton("Rename", "", () => renameSubgroup(group, name)),
        miniButton("Delete", "danger", () => deleteSubgroup(group, name))
      );
      subgroupRow.append(subgroupActions);
      subgroupArea.append(subgroupRow);
    });
    const addSubgroupRow = element("div", "subgroup-add-row");
    const input = element("input");
    input.type = "text";
    input.placeholder = `New subgroup in ${group}…`;
    const addButton = miniButton("Add Subgroup", "", () => addSubgroup(group, input));
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addButton.click();
    });
    addSubgroupRow.append(input, addButton);
    subgroupArea.append(addSubgroupRow);
    card.append(subgroupArea);
    groupsList.append(card);
  });
}

function clearForm() {
  editingId = null;
  editorVisible = false;
  stationEditor.hidden = true;
  stationFormTitle.textContent = "Add Station";
  stationName.value = "";
  stationUrl.value = "";
  stationCountry.value = "";
  stationDescription.value = "";
  stationFavorite.checked = false;
  stationNoPreRoll.checked = false;
  stationGroup.value = "Other";
  rebuildSubgroupControl("");
  setStatus(statusStations);
  testUrlStatus.textContent = "";
  renderStationsTable();
}

function startEdit(id) {
  const station = stations.find((item) => item.id === id);
  if (!station) return;
  editingId = id;
  editorVisible = true;
  stationFormTitle.textContent = "Edit Station";
  stationName.value = station.name;
  stationUrl.value = station.url;
  stationCountry.value = station.country || "";
  stationDescription.value = station.description || "";
  stationFavorite.checked = Boolean(station.favorite);
  stationNoPreRoll.checked = Boolean(station.noPreRoll);
  stationGroup.value = normalizeGroupName(station.group);
  rebuildSubgroupControl(station.subgroup || "");
  testUrlStatus.textContent = "";
  renderStationsTable();
  setTimeout(() => {
    stationEditor.scrollIntoView({ behavior: "smooth", block: "nearest" });
    stationName.focus();
  }, 100);
}

function startNewStation() {
  editingId = null;
  editorVisible = true;
  stationFormTitle.textContent = "Add Station";
  stationName.value = "";
  stationUrl.value = "";
  stationCountry.value = "";
  stationDescription.value = "";
  stationFavorite.checked = false;
  stationNoPreRoll.checked = false;
  stationGroup.value = "Other";
  rebuildSubgroupControl("");
  testUrlStatus.textContent = "";
  setStatus(statusStations);
  renderStationsTable();
  setTimeout(() => stationName.focus(), 50);
}

function requestStationEdit(id) {
  const stationId = String(id ?? "").trim();
  if (!stationId) return;
  if (!initialized) {
    pendingEditId = stationId;
    return;
  }
  showTab("stations");
  stationSearch.value = "";
  stationGroupFilter.value = "";
  startEdit(stationId);
}

async function saveStations() {
  stations = await window.wavedeck.saveStations(stations);
  renderStationsTable();
}

async function deleteStation(id) {
  const station = stations.find((item) => item.id === id);
  if (!station || !confirm(`Delete "${station.name}"?`)) return;
  try {
    stations = stations.filter((item) => item.id !== id);
    await saveStations();
    if (editingId === id) clearForm();
  } catch (error) {
    setStatus(statusStations, `Delete failed: ${error.message}`, false);
    await reloadEverything();
  }
}

stationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = stationName.value.trim();
  const url = stationUrl.value.trim();
  if (!name || !url) return setStatus(statusStations, "Name and URL are required.", false);

  const existing = editingId ? stations.find((station) => station.id === editingId) : null;
  let favoriteOrder = null;
  if (stationFavorite.checked) {
    favoriteOrder = existing?.favorite
      ? existing.favoriteOrder
      : normalizeFavoriteOrder(stations).length;
  }

  const next = {
    id: editingId || createId(),
    name,
    url,
    group: normalizeGroupName(stationGroup.value),
    favorite: stationFavorite.checked,
    favoriteOrder,
    country: stationCountry.value.trim(),
    subgroup: stationSubgroup.value.trim(),
    description: stationDescription.value.trim(),
    noPreRoll: stationNoPreRoll.checked
  };

  if (editingId) {
    const index = stations.findIndex((station) => station.id === editingId);
    if (index < 0) return setStatus(statusStations, "The station being edited no longer exists.", false);
    stations[index] = next;
  } else {
    stations.push(next);
  }

  try {
    await saveStations();
    clearForm();
    setStatus(statusStations, "Station saved.");
  } catch (error) {
    setStatus(statusStations, `Save failed: ${error.message}`, false);
  }
});

newStationBtn.addEventListener("click", () => {
  startNewStation();
});
cancelEditBtn.addEventListener("click", clearForm);
stationSearch.addEventListener("input", renderStationsTable);
stationGroupFilter.addEventListener("change", renderStationsTable);
stationGroup.addEventListener("change", () => rebuildSubgroupControl(""));

resetListeningBtn.addEventListener("click", async () => {
  if (!confirm("Reset all WaveDeck listening history?\n\nThis cannot be undone.")) return;
  resetListeningBtn.disabled = true;
  try {
    listeningHistory = await window.wavedeck.resetListeningHistory();
    renderStationsTable();
    setStatus(statusStations, "Listening history reset.");
  } catch (error) {
    setStatus(statusStations, `Could not reset listening history: ${error.message}`, false);
  } finally {
    resetListeningBtn.disabled = false;
  }
});

testUrlBtn.addEventListener("click", async () => {
  const url = stationUrl.value.trim();
  if (!url) {
    testUrlStatus.textContent = "Enter a URL first.";
    return;
  }

  testUrlBtn.disabled = true;
  testUrlStatus.textContent = "Testing…";
  try {
    const result = await window.wavedeck.testStreamUrl(url);
    testUrlStatus.textContent = result?.message || (result?.ok ? "Working." : "Failed.");
  } catch (error) {
    testUrlStatus.textContent = `Failed (${error.message}).`;
  } finally {
    testUrlBtn.disabled = false;
  }
});

async function saveGroups() {
  groups = await window.wavedeck.saveGroups(groups);
  rebuildGroupControls();
  renderGroups();
}

async function saveSubgroupConfig(message = "Subgroup order saved.") {
  subgroupConfig = await window.wavedeck.saveSubgroups(subgroupConfig);
  rebuildSubgroupControl();
  renderGroups();
  setStatus(statusGroups, message);
}

function subgroupEntry(group, { create = false } = {}) {
  let entry = subgroupConfig.groups.find((item) => lowerKey(item.group) === lowerKey(group));
  if (!entry && create) {
    entry = { group, subgroups: [] };
    subgroupConfig.groups.push(entry);
  }
  return entry;
}

async function addSubgroup(group, input) {
  const name = input.value.trim();
  if (!name) return setStatus(statusGroups, "Enter a subgroup name.", false);
  const entry = subgroupEntry(group, { create: true });
  if (entry.subgroups.some((item) => lowerKey(item) === lowerKey(name))) {
    return setStatus(statusGroups, "That subgroup already exists in this group.", false);
  }
  entry.subgroups.push(name);
  try {
    await saveSubgroupConfig(`Subgroup "${name}" added.`);
  } catch (error) {
    setStatus(statusGroups, `Could not add subgroup: ${error.message}`, false);
    await reloadEverything();
  }
}

async function moveSubgroup(group, index, direction) {
  const entry = subgroupEntry(group);
  const target = index + direction;
  if (!entry || target < 0 || target >= entry.subgroups.length) return;
  [entry.subgroups[index], entry.subgroups[target]] = [entry.subgroups[target], entry.subgroups[index]];
  try {
    await saveSubgroupConfig();
  } catch (error) {
    setStatus(statusGroups, `Could not reorder subgroup: ${error.message}`, false);
    await reloadEverything();
  }
}

async function renameSubgroup(group, oldName) {
  const nextName = prompt(`Rename subgroup "${oldName}" to:`, oldName)?.trim();
  if (!nextName || nextName === oldName) return;
  try {
    const result = await window.wavedeck.renameSubgroup(group, oldName, nextName);
    if (!result?.ok) throw new Error(result?.reason || "Subgroup could not be renamed.");
    await reloadEverything();
    setStatus(statusGroups, `Subgroup renamed to "${nextName}".`);
  } catch (error) {
    setStatus(statusGroups, `Could not rename subgroup: ${error.message}`, false);
  }
}

async function deleteSubgroup(group, name) {
  if (!confirm(`Delete subgroup "${name}"?\n\nIts stations will remain in "${group}" without a subgroup.`)) return;
  try {
    const result = await window.wavedeck.removeSubgroup(group, name);
    if (!result?.ok) throw new Error(result?.reason || "Subgroup could not be removed.");
    await reloadEverything();
    setStatus(statusGroups, `Subgroup "${name}" deleted.`);
  } catch (error) {
    setStatus(statusGroups, `Could not delete subgroup: ${error.message}`, false);
  }
}

async function moveGroup(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= groups.length - 1) return;
  [groups[index], groups[target]] = [groups[target], groups[index]];
  try {
    await saveGroups();
    setStatus(statusGroups, "Group order saved.");
  } catch (error) {
    setStatus(statusGroups, `Could not save group order: ${error.message}`, false);
  }
}

async function deleteGroup(group) {
  if (!confirm(`Delete group "${group}"?\n\nStations in this group will be moved to "Other".`)) return;
  try {
    const result = await window.wavedeck.removeGroup(group);
    if (!result?.ok) throw new Error(result?.reason || "Group could not be removed.");
    await reloadEverything();
    setStatus(statusGroups, `Group "${group}" deleted.`);
  } catch (error) {
    setStatus(statusGroups, `Delete failed: ${error.message}`, false);
  }
}

addGroupBtn.addEventListener("click", async () => {
  const name = newGroupInput.value.trim();
  if (!name) return setStatus(statusGroups, "Enter a group name.", false);
  if (lowerKey(name) === "other" || groups.some((group) => lowerKey(group) === lowerKey(name))) {
    return setStatus(statusGroups, "That group already exists.", false);
  }

  groups = [...groups.filter((group) => lowerKey(group) !== "other"), name, "Other"];
  try {
    await saveGroups();
    newGroupInput.value = "";
    setStatus(statusGroups, `Group "${name}" added.`);
  } catch (error) {
    setStatus(statusGroups, `Could not add group: ${error.message}`, false);
  }
});

newGroupInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addGroupBtn.click();
});

exportStationsBtn.addEventListener("click", async () => {
  setStatus(statusImportExport);
  try {
    const result = await window.wavedeck.exportStations();
    if (result?.canceled) return setStatus(statusImportExport, "Export canceled.");
    setStatus(statusImportExport, `Export complete (${result.count} stations).`);
  } catch (error) {
    setStatus(statusImportExport, `Export failed: ${error.message}`, false);
  }
});

importStationsBtn.addEventListener("click", async () => {
  setStatus(statusImportExport);
  if (!confirm("Import will replace your current station library.\nA backup will be made.\n\nContinue?")) return;
  try {
    const result = await window.wavedeck.importStationsReplace();
    if (result?.canceled) return setStatus(statusImportExport, "Import canceled.");
    await reloadEverything();
    clearForm();
    setStatus(statusImportExport, `Import complete (${result.count} stations).`);
  } catch (error) {
    setStatus(statusImportExport, `Import failed: ${error.message}`, false);
  }
});

installLauncherBtn.addEventListener("click", async () => {
  installLauncherBtn.disabled = true;
  removeLauncherBtn.disabled = true;
  setStatus(statusLauncher, "Adding WaveDeck to the Applications menu…");
  try {
    renderLauncherStatus(await window.wavedeck.installLauncher());
    setStatus(statusLauncher, "Added. Open the Mint menu, find WaveDeck, right-click it, and choose Add to panel.");
  } catch (error) {
    setStatus(statusLauncher, `Could not add the launcher: ${error.message}`, false);
    await loadLauncherStatus();
  }
});

removeLauncherBtn.addEventListener("click", async () => {
  installLauncherBtn.disabled = true;
  removeLauncherBtn.disabled = true;
  setStatus(statusLauncher, "Removing the WaveDeck launcher…");
  try {
    renderLauncherStatus(await window.wavedeck.removeLauncher());
    setStatus(statusLauncher, "WaveDeck was removed from the Applications menu.");
  } catch (error) {
    setStatus(statusLauncher, `Could not remove the launcher: ${error.message}`, false);
    await loadLauncherStatus();
  }
});

async function reloadEverything() {
  await loadData();
  rebuildGroupControls();
  renderStationsTable();
  renderGroups();
}

function queueReload() {
  if (reloadQueued) return;
  reloadQueued = true;
  queueMicrotask(async () => {
    reloadQueued = false;
    try {
      await reloadEverything();
    } catch (error) {
      setStatus(statusStations, `Refresh failed: ${error.message}`, false);
    }
  });
}

window.wavedeck.onStationsChanged(queueReload);
window.wavedeck.onGroupsChanged(queueReload);
window.wavedeck.onSubgroupsChanged(queueReload);
window.wavedeck.onListeningHistoryChanged((history) => {
  listeningHistory = history || { version: 1, stations: {} };
  renderStationsTable();
});
window.wavedeck.onEditStationRequested(requestStationEdit);
window.wavedeck.onWarning((warning) => setStatus(statusStations, warning, false));

(async function initialize() {
  showTab(document.querySelector(".tab.active")?.dataset.tab || "stations");
  await Promise.all([reloadEverything(), loadLauncherStatus()]);
  clearForm();
  initialized = true;
  if (pendingEditId) {
    const requestedId = pendingEditId;
    pendingEditId = "";
    requestStationEdit(requestedId);
  }

  const info = await window.wavedeck.getAppInfo();
  const version = document.getElementById("aboutVersion");
  const dataDir = document.getElementById("aboutDataDir");
  if (version) version.textContent = info.version;
  if (dataDir) dataDir.textContent = info.dataDir;
})();
