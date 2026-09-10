const fs = require("fs");
const path = require("path");

const LIBRARY_FILE = "library.json";
const PREFERENCES_FILE = "preferences.json";
const LEGACY_FILES = ["stations.json", "groups.json", "subgroups.json"];
const NOTEPAD_FILE = "notepad.txt";
const LISTENING_HISTORY_FILE = "listening-history.json";
const STARTER_PRESET_NAMES = Object.freeze([
  "Virgin Radio Classic Rock",
  "Swiss Pop",
  "I Love Hip-Hop",
  "Today's Hot Country",
  "Radio Motown",
  "Adroit Jazz Underground",
  "Groove Salad"
]);

function validateListeningHistory(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value.stations : null;
  const stations = {};
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [rawId, rawEntry] of Object.entries(source)) {
      const id = String(rawId ?? "").trim();
      if (!id || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const seconds = Math.max(0, Math.floor(Number(rawEntry.seconds) || 0));
      if (!seconds) continue;
      stations[id] = {
        seconds,
        lastListenedAt: typeof rawEntry.lastListenedAt === "string" ? rawEntry.lastListenedAt : ""
      };
    }
  }
  return { version: 1, stations };
}

function lowerKey(value) { return String(value ?? "").trim().toLowerCase(); }
function normalizeGroupName(value) { return String(value ?? "").trim() || "Other"; }
function normalizeSubgroupName(value) { return String(value ?? "").trim(); }

function ensureOtherLast(values) {
  const seen = new Set();
  const cleaned = [];
  for (const value of Array.isArray(values) ? values : []) {
    const name = normalizeGroupName(value);
    const key = lowerKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (key !== "other") cleaned.push(name);
  }
  cleaned.push("Other");
  return cleaned;
}

function createStationId() {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanPresetOrder(value) {
  if (value === null || value === undefined || value === "") return null;
  const order = Number(value);
  return Number.isSafeInteger(order) && order >= 0 ? order : null;
}

function cleanStationGainDb(value) {
  const gain = Number(value);
  if (!Number.isFinite(gain)) return 0;
  return Math.round(Math.min(Math.max(gain, -12), 12) * 2) / 2;
}

function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

function cleanStation(raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Station ${index + 1} is not an object.`);
  }
  const name = String(raw.name ?? "").trim();
  const url = String(raw.url ?? "").trim();
  if (!name || !url) throw new Error(`Station ${index + 1} must have a name and URL.`);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`Station ${index + 1} has an invalid URL.`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Station ${index + 1} must use an HTTP or HTTPS URL.`);
  }

  // Before v0.2.3, `favorite` represented what is now called Presets.
  const currentSchema = hasOwn(raw, "preset");
  const preset = currentSchema ? Boolean(raw.preset) : Boolean(raw.favorite);
  const favorite = currentSchema ? Boolean(raw.favorite) : false;
  const presetOrderSource = currentSchema ? raw.presetOrder : raw.favoriteOrder;
  return {
    id: String(raw.id ?? "").trim() || createStationId(),
    name,
    url: parsed.toString(),
    group: normalizeGroupName(raw.group),
    favorite,
    preset,
    presetOrder: preset ? cleanPresetOrder(presetOrderSource) : null,
    country: String(raw.country ?? "").trim(),
    subgroup: normalizeSubgroupName(raw.subgroup),
    description: String(raw.description ?? "").trim().slice(0, 2000),
    hasPreRoll: currentSchema && Boolean(raw.hasPreRoll),
    gainDb: cleanStationGainDb(raw.gainDb)
  };
}

function validateStations(values) {
  if (!Array.isArray(values)) throw new Error("Station data must be a JSON array.");
  const stations = values.map(cleanStation);
  const ids = new Set();
  for (const station of stations) {
    if (ids.has(station.id)) throw new Error(`Duplicate station ID: ${station.id}`);
    ids.add(station.id);
  }
  return stations;
}

function validateGroups(values) {
  if (!Array.isArray(values)) throw new Error("Group data must be a JSON array.");
  return ensureOtherLast(values);
}

function validateSubgroups(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value.groups : null;
  const groups = [];
  const seenGroups = new Set();
  for (const rawEntry of Array.isArray(source) ? source : []) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
    const group = normalizeGroupName(rawEntry.group);
    const groupKey = lowerKey(group);
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    const seenNames = new Set();
    const subgroups = [];
    for (const rawName of Array.isArray(rawEntry.subgroups) ? rawEntry.subgroups : []) {
      const name = normalizeSubgroupName(rawName);
      const key = lowerKey(name);
      if (!name || seenNames.has(key)) continue;
      seenNames.add(key);
      subgroups.push(name);
    }
    if (subgroups.length) groups.push({ group, subgroups });
  }
  return { version: 1, groups };
}

function libraryStation(station) {
  return {
    id: station.id,
    name: station.name,
    url: station.url,
    group: station.group,
    country: station.country,
    subgroup: station.subgroup,
    description: station.description,
    hasPreRoll: station.hasPreRoll
  };
}

function addStationStructure(groups, subgroups, stations) {
  const groupNames = [...groups];
  const entries = subgroups.groups.map((entry) => ({ group: entry.group, subgroups: [...entry.subgroups] }));
  for (const station of stations) {
    if (!groupNames.some((name) => lowerKey(name) === lowerKey(station.group))) {
      groupNames.splice(Math.max(0, groupNames.length - 1), 0, station.group);
    }
    if (!station.subgroup) continue;
    let entry = entries.find((item) => lowerKey(item.group) === lowerKey(station.group));
    if (!entry) {
      entry = { group: station.group, subgroups: [] };
      entries.push(entry);
    }
    if (!entry.subgroups.some((name) => lowerKey(name) === lowerKey(station.subgroup))) {
      entry.subgroups.push(station.subgroup);
    }
  }
  return { groups: ensureOtherLast(groupNames), subgroups: validateSubgroups({ version: 1, groups: entries }) };
}

function validateLibrary(value) {
  // Old station-only exports remain importable. Their hierarchy is inferred.
  if (Array.isArray(value)) {
    const stations = validateStations(value).map(libraryStation);
    const structure = addStationStructure(["Other"], validateSubgroups(null), stations);
    return { version: 1, groups: structure.groups, subgroups: structure.subgroups, stations };
  }
  if (!value || typeof value !== "object") throw new Error("Library data must be a JSON object.");
  const rawStations = Array.isArray(value.stations)
    ? value.stations.map((station) => (
      station && typeof station === "object" && !Array.isArray(station)
        ? { ...station, favorite: false, preset: false, presetOrder: null }
        : station
    ))
    : value.stations;
  const stations = validateStations(rawStations).map(libraryStation);
  const structure = addStationStructure(
    validateGroups(Array.isArray(value.groups) ? value.groups : ["Other"]),
    validateSubgroups(value.subgroups),
    stations
  );
  return { version: 1, groups: structure.groups, subgroups: structure.subgroups, stations };
}

function validatePreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value.stations : null;
  const stations = {};
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [rawId, rawEntry] of Object.entries(source)) {
      const id = String(rawId ?? "").trim();
      if (!id || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const favorite = Boolean(rawEntry.favorite);
      const preset = Boolean(rawEntry.preset);
      const gainDb = cleanStationGainDb(rawEntry.gainDb);
      if (!favorite && !preset && gainDb === 0) continue;
      const stationPreferences = {
        favorite,
        preset,
        presetOrder: preset ? cleanPresetOrder(rawEntry.presetOrder) : null
      };
      if (gainDb !== 0) stationPreferences.gainDb = gainDb;
      stations[id] = stationPreferences;
    }
  }
  const rawDeletedIds = value && typeof value === "object" && !Array.isArray(value)
    ? value.deletedOfficialStationIds
    : null;
  const deletedOfficialStationIds = [];
  const seenDeletedIds = new Set();
  for (const rawId of Array.isArray(rawDeletedIds) ? rawDeletedIds : []) {
    const id = String(rawId ?? "").trim();
    if (!id || seenDeletedIds.has(id)) continue;
    seenDeletedIds.add(id);
    deletedOfficialStationIds.push(id);
  }
  const parsedUpdatedAt = Date.parse(String(value?.lastLibraryUpdate ?? ""));
  const rawSettingsBounds = value?.settingsWindowBounds;
  const settingsWindowBounds = rawSettingsBounds && typeof rawSettingsBounds === "object" && !Array.isArray(rawSettingsBounds) &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(Number(rawSettingsBounds[key])))
    ? {
        x: Math.round(Number(rawSettingsBounds.x)),
        y: Math.round(Number(rawSettingsBounds.y)),
        width: Math.max(1, Math.round(Number(rawSettingsBounds.width))),
        height: Math.max(1, Math.round(Number(rawSettingsBounds.height)))
      }
    : null;
  return {
    version: 1,
    stations,
    downloadNewStations: typeof value?.downloadNewStations === "boolean"
      ? value.downloadNewStations
      : true,
    launchInSidebarMode: value?.launchInSidebarMode === true,
    settingsWindowBounds,
    lastLibraryUpdate: Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt).toISOString() : "",
    deletedOfficialStationIds
  };
}

function preferencesFromStations(stations) {
  const preferences = validatePreferences(null);
  for (const station of stations) {
    const gainDb = cleanStationGainDb(station.gainDb);
    if (!station.favorite && !station.preset && gainDb === 0) continue;
    const stationPreferences = {
      favorite: Boolean(station.favorite),
      preset: Boolean(station.preset),
      presetOrder: station.preset ? cleanPresetOrder(station.presetOrder) : null
    };
    if (gainDb !== 0) stationPreferences.gainDb = gainDb;
    preferences.stations[station.id] = stationPreferences;
  }
  return preferences;
}

function starterPreferences(stations) {
  const byName = new Map(stations.map((station) => [lowerKey(station.name), station]));
  const preferences = validatePreferences(null);
  STARTER_PRESET_NAMES.forEach((name, presetOrder) => {
    const station = byName.get(lowerKey(name));
    if (!station) return;
    preferences.stations[station.id] = {
      favorite: false,
      preset: true,
      presetOrder
    };
  });
  return preferences;
}

class PortableStorage {
  constructor({ dataDir, defaultsDir, onWarning = () => {} }) {
    this.dataDir = dataDir;
    this.defaultsDir = defaultsDir;
    this.backupDir = path.join(dataDir, "backups");
    this.onWarning = onWarning;
  }

  initialize() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.#initializeLibraryAndPreferences();
    if (!fs.existsSync(this.getListeningHistoryPath())) {
      this.#atomicWrite(LISTENING_HISTORY_FILE, validateListeningHistory(null), { createBackup: false });
    }
    if (!fs.existsSync(this.getNotepadPath())) this.#atomicWriteText(NOTEPAD_FILE, "", { createBackup: false });
  }

  assertWritable() {
    const probe = path.join(this.dataDir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, "ok", "utf8");
    fs.unlinkSync(probe);
    return true;
  }

  getLibraryPath() { return path.join(this.dataDir, LIBRARY_FILE); }
  getPreferencesPath() { return path.join(this.dataDir, PREFERENCES_FILE); }
  getNotepadPath() { return path.join(this.dataDir, NOTEPAD_FILE); }
  getListeningHistoryPath() { return path.join(this.dataDir, LISTENING_HISTORY_FILE); }

  readLibrary() {
    return this.#readValidated(
      LIBRARY_FILE,
      validateLibrary,
      { version: 1, groups: ["Other"], subgroups: validateSubgroups(null), stations: [] }
    );
  }
  readPreferences() {
    return this.#readValidated(PREFERENCES_FILE, validatePreferences, validatePreferences(null));
  }
  readStations() {
    const library = this.readLibrary();
    const preferences = this.readPreferences().stations;
    return library.stations.map((station) => {
      const preference = preferences[station.id] || {};
      return {
        ...station,
        favorite: Boolean(preference.favorite),
        preset: Boolean(preference.preset),
        presetOrder: preference.preset ? cleanPresetOrder(preference.presetOrder) : null,
        gainDb: cleanStationGainDb(preference.gainDb)
      };
    });
  }

  writeStations(values) {
    const stations = validateStations(values);
    const library = this.readLibrary();
    const currentPreferences = this.readPreferences();
    const updatedIds = new Set(stations.map((station) => station.id));
    for (const id of updatedIds) delete currentPreferences.stations[id];
    Object.assign(currentPreferences.stations, preferencesFromStations(stations).stations);
    library.stations = stations.map(libraryStation);
    this.#atomicWrite(LIBRARY_FILE, validateLibrary(library));
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(currentPreferences));
    return this.readStations();
  }

  readGroups() { return this.readLibrary().groups; }
  writeGroups(values) {
    const library = this.readLibrary();
    library.groups = validateGroups(values);
    const saved = validateLibrary(library);
    this.#atomicWrite(LIBRARY_FILE, saved);
    return saved.groups;
  }
  readSubgroups() { return this.readLibrary().subgroups; }
  writeSubgroups(value) {
    const library = this.readLibrary();
    library.subgroups = validateSubgroups(value);
    const saved = validateLibrary(library);
    this.#atomicWrite(LIBRARY_FILE, saved);
    return saved.subgroups;
  }

  readNotepad() {
    try { return fs.readFileSync(this.getNotepadPath(), "utf8"); }
    catch (error) {
      this.onWarning(`The notepad could not be read: ${error.message}`);
      return "";
    }
  }
  writeNotepad(value) {
    const text = String(value ?? "").slice(0, 100000);
    this.#atomicWriteText(NOTEPAD_FILE, text);
    return text;
  }
  readListeningHistory() {
    return this.#readValidated(LISTENING_HISTORY_FILE, validateListeningHistory, validateListeningHistory(null));
  }
  writeListeningHistory(value) {
    const history = validateListeningHistory(value);
    this.#atomicWrite(LISTENING_HISTORY_FILE, history);
    return history;
  }

  exportLibrary(now = new Date()) {
    const updatedAt = now instanceof Date ? now.toISOString() : String(now ?? "");
    const parsedUpdatedAt = Date.parse(updatedAt);
    if (!Number.isFinite(parsedUpdatedAt)) throw new Error("The library export timestamp is invalid.");
    return {
      ...this.readLibrary(),
      updatedAt: new Date(parsedUpdatedAt).toISOString()
    };
  }

  getLibraryUpdateState() {
    const preferences = this.readPreferences();
    return {
      enabled: preferences.downloadNewStations,
      lastLibraryUpdate: preferences.lastLibraryUpdate
    };
  }

  setLibraryUpdatesEnabled(enabled) {
    const preferences = this.readPreferences();
    preferences.downloadNewStations = Boolean(enabled);
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(preferences));
    return this.getLibraryUpdateState();
  }

  getUiPreferences() {
    const preferences = this.readPreferences();
    return {
      launchInSidebarMode: preferences.launchInSidebarMode,
      settingsWindowBounds: preferences.settingsWindowBounds
        ? { ...preferences.settingsWindowBounds }
        : null
    };
  }

  getLinuxUiPreferences() {
    return this.getUiPreferences();
  }

  setLaunchInSidebarMode(enabled) {
    const preferences = this.readPreferences();
    preferences.launchInSidebarMode = Boolean(enabled);
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(preferences));
    return this.getUiPreferences();
  }

  setSettingsWindowBounds(bounds) {
    const preferences = this.readPreferences();
    preferences.settingsWindowBounds = bounds;
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(preferences));
    return this.getUiPreferences().settingsWindowBounds;
  }

  setStationGain(stationId, value) {
    const id = String(stationId ?? "").trim();
    if (!id || !this.readLibrary().stations.some((station) => station.id === id)) {
      throw new Error("That station is no longer in WaveDeck.");
    }
    const gainDb = cleanStationGainDb(value);
    const preferences = this.readPreferences();
    const current = preferences.stations[id] || {
      favorite: false,
      preset: false,
      presetOrder: null
    };
    if (gainDb === 0) delete current.gainDb;
    else current.gainDb = gainDb;
    if (current.favorite || current.preset || current.gainDb) preferences.stations[id] = current;
    else delete preferences.stations[id];
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(preferences));
    return gainDb;
  }

  deleteStation(stationId) {
    const id = String(stationId ?? "").trim();
    if (!id) return { ok: false, reason: "Select a station to delete." };
    const library = this.readLibrary();
    const station = library.stations.find((item) => item.id === id);
    if (!station) return { ok: false, reason: "That station no longer exists." };

    library.stations = library.stations.filter((item) => item.id !== id);
    const preferences = this.readPreferences();
    delete preferences.stations[id];
    if (!preferences.deletedOfficialStationIds.includes(id)) {
      preferences.deletedOfficialStationIds.push(id);
    }
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(preferences));
    this.#atomicWrite(LIBRARY_FILE, validateLibrary(library));
    return { ok: true, station };
  }

  applyLibraryUpdate(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The downloaded library must be a JSON object.");
    }
    const parsedUpdatedAt = Date.parse(String(value.updatedAt ?? ""));
    if (!Number.isFinite(parsedUpdatedAt)) {
      throw new Error("The downloaded library does not have a valid updatedAt timestamp.");
    }
    if (!Array.isArray(value.stations) || value.stations.some((station) => (
      !station || typeof station !== "object" || !String(station.id ?? "").trim()
    ))) {
      throw new Error("Every downloaded station must have a permanent station ID.");
    }
    const updatedAt = new Date(parsedUpdatedAt).toISOString();
    const incoming = validateLibrary(value);
    const preferences = this.readPreferences();
    const previousUpdateTime = Date.parse(preferences.lastLibraryUpdate);
    if (Number.isFinite(previousUpdateTime) && parsedUpdatedAt <= previousUpdateTime) {
      return { applied: false, addedStations: 0, updatedStations: 0, addedGroups: 0, addedSubgroups: 0 };
    }

    const current = this.readLibrary();
    const stationsById = new Map(current.stations.map((station) => [station.id, station]));
    const deletedIds = new Set(preferences.deletedOfficialStationIds);
    let addedStations = 0;
    let updatedStations = 0;
    for (const incomingStation of incoming.stations) {
      const existing = stationsById.get(incomingStation.id);
      if (existing) {
        const nextUrl = incomingStation.url;
        const nextCountry = incomingStation.country;
        const nextDescription = incomingStation.description;
        if (
          existing.url !== nextUrl ||
          existing.country !== nextCountry ||
          existing.description !== nextDescription
        ) {
          existing.url = nextUrl;
          existing.country = nextCountry;
          existing.description = nextDescription;
          updatedStations += 1;
        }
        continue;
      }
      if (deletedIds.has(incomingStation.id)) continue;
      const addition = { ...incomingStation };
      current.stations.push(addition);
      stationsById.set(addition.id, addition);
      addedStations += 1;
    }

    let addedGroups = 0;
    for (const group of incoming.groups) {
      if (
        lowerKey(group) === "other" ||
        current.groups.some((existing) => lowerKey(existing) === lowerKey(group))
      ) continue;
      current.groups.splice(Math.max(0, current.groups.length - 1), 0, group);
      addedGroups += 1;
    }

    const subgroupEntries = current.subgroups.groups.map((entry) => ({
      group: entry.group,
      subgroups: [...entry.subgroups]
    }));
    let addedSubgroups = 0;
    for (const incomingEntry of incoming.subgroups.groups) {
      let entry = subgroupEntries.find((item) => lowerKey(item.group) === lowerKey(incomingEntry.group));
      if (!entry) {
        entry = { group: incomingEntry.group, subgroups: [] };
        subgroupEntries.push(entry);
      }
      for (const subgroup of incomingEntry.subgroups) {
        if (entry.subgroups.some((existing) => lowerKey(existing) === lowerKey(subgroup))) continue;
        entry.subgroups.push(subgroup);
        addedSubgroups += 1;
      }
    }
    current.subgroups = { version: 1, groups: subgroupEntries };

    const merged = validateLibrary(current);
    if (addedStations || updatedStations || addedGroups || addedSubgroups) {
      this.#atomicWrite(LIBRARY_FILE, merged);
    }
    preferences.lastLibraryUpdate = updatedAt;
    this.#atomicWrite(PREFERENCES_FILE, validatePreferences(preferences));
    return { applied: true, addedStations, updatedStations, addedGroups, addedSubgroups };
  }

  importLibrary(value, { mode = "add" } = {}) {
    const incoming = validateLibrary(value);
    if (mode === "replace") {
      this.#atomicWrite(LIBRARY_FILE, incoming);
      return {
        mode,
        stationCount: incoming.stations.length,
        addedStations: incoming.stations.length,
        addedGroups: incoming.groups.filter((name) => lowerKey(name) !== "other").length,
        addedSubgroups: incoming.subgroups.groups.reduce((sum, entry) => sum + entry.subgroups.length, 0)
      };
    }
    if (mode !== "add") throw new Error("Unknown library import mode.");

    const current = this.readLibrary();
    const ids = new Set(current.stations.map((station) => station.id));
    const identities = new Set(current.stations.map((station) => `${lowerKey(station.name)}\n${lowerKey(station.url)}`));
    const additions = incoming.stations.filter((station) => {
      const identity = `${lowerKey(station.name)}\n${lowerKey(station.url)}`;
      if (ids.has(station.id) || identities.has(identity)) return false;
      ids.add(station.id);
      identities.add(identity);
      return true;
    });

    const nextGroups = [...current.groups];
    let addedGroups = 0;
    for (const group of incoming.groups) {
      if (lowerKey(group) === "other" || nextGroups.some((name) => lowerKey(name) === lowerKey(group))) continue;
      nextGroups.splice(Math.max(0, nextGroups.length - 1), 0, group);
      addedGroups += 1;
    }
    const subgroupEntries = current.subgroups.groups.map((entry) => ({ group: entry.group, subgroups: [...entry.subgroups] }));
    let addedSubgroups = 0;
    for (const incomingEntry of incoming.subgroups.groups) {
      let entry = subgroupEntries.find((item) => lowerKey(item.group) === lowerKey(incomingEntry.group));
      if (!entry) {
        entry = { group: incomingEntry.group, subgroups: [] };
        subgroupEntries.push(entry);
      }
      for (const subgroup of incomingEntry.subgroups) {
        if (entry.subgroups.some((name) => lowerKey(name) === lowerKey(subgroup))) continue;
        entry.subgroups.push(subgroup);
        addedSubgroups += 1;
      }
    }
    const merged = validateLibrary({
      version: 1,
      groups: nextGroups,
      subgroups: { version: 1, groups: subgroupEntries },
      stations: [...current.stations, ...additions]
    });
    this.#atomicWrite(LIBRARY_FILE, merged);
    return { mode, stationCount: merged.stations.length, addedStations: additions.length, addedGroups, addedSubgroups };
  }

  syncGroupsWithStations(stations) {
    const groups = this.readGroups();
    const keys = new Set(groups.map(lowerKey));
    const additions = [];
    for (const station of stations) {
      const group = normalizeGroupName(station.group);
      const key = lowerKey(group);
      if (key !== "other" && !keys.has(key)) { keys.add(key); additions.push(group); }
    }
    if (!additions.length) return groups;
    return this.writeGroups([...groups.filter((group) => lowerKey(group) !== "other"), ...additions, "Other"]);
  }

  syncSubgroupsWithStations(stations) {
    const config = this.readSubgroups();
    const entries = config.groups.map((entry) => ({ group: entry.group, subgroups: [...entry.subgroups] }));
    for (const station of stations) {
      const subgroup = normalizeSubgroupName(station.subgroup);
      if (!subgroup) continue;
      const group = normalizeGroupName(station.group);
      let entry = entries.find((item) => lowerKey(item.group) === lowerKey(group));
      if (!entry) { entry = { group, subgroups: [] }; entries.push(entry); }
      if (!entry.subgroups.some((name) => lowerKey(name) === lowerKey(subgroup))) entry.subgroups.push(subgroup);
    }
    const next = validateSubgroups({ version: 1, groups: entries });
    if (JSON.stringify(next) === JSON.stringify(config)) return config;
    return this.writeSubgroups(next);
  }

  saveSubgroups(value) { return this.writeSubgroups(value); }

  removeGroup(groupName) {
    const target = normalizeGroupName(groupName);
    if (lowerKey(target) === "other") return { ok: false, reason: "The Other group cannot be removed." };
    const stations = this.readStations().map((station) => lowerKey(station.group) === lowerKey(target)
      ? { ...station, group: "Other", subgroup: "" } : station);
    const groups = this.readGroups().filter((group) => lowerKey(group) !== lowerKey(target));
    const subgroups = this.readSubgroups();
    subgroups.groups = subgroups.groups.filter((entry) => lowerKey(entry.group) !== lowerKey(target));
    this.writeStations(stations);
    this.writeGroups(groups);
    this.writeSubgroups(subgroups);
    return { ok: true, stations: this.readStations(), groups: this.readGroups() };
  }

  renameSubgroup(groupName, oldName, newName) {
    const group = normalizeGroupName(groupName);
    const oldSubgroup = normalizeSubgroupName(oldName);
    const nextSubgroup = normalizeSubgroupName(newName);
    if (!oldSubgroup || !nextSubgroup) return { ok: false, reason: "Subgroup names cannot be empty." };
    const config = this.readSubgroups();
    const entry = config.groups.find((item) => lowerKey(item.group) === lowerKey(group));
    if (!entry || !entry.subgroups.some((name) => lowerKey(name) === lowerKey(oldSubgroup))) {
      return { ok: false, reason: "That subgroup no longer exists." };
    }
    if (entry.subgroups.some((name) => lowerKey(name) === lowerKey(nextSubgroup) && lowerKey(name) !== lowerKey(oldSubgroup))) {
      return { ok: false, reason: "That subgroup name is already in use." };
    }
    entry.subgroups = entry.subgroups.map((name) => lowerKey(name) === lowerKey(oldSubgroup) ? nextSubgroup : name);
    const stations = this.readStations().map((station) => (
      lowerKey(station.group) === lowerKey(group) && lowerKey(station.subgroup) === lowerKey(oldSubgroup)
        ? { ...station, subgroup: nextSubgroup } : station
    ));
    this.writeStations(stations);
    this.writeSubgroups(config);
    return { ok: true, stations: this.readStations(), subgroups: this.readSubgroups() };
  }

  removeSubgroup(groupName, subgroupName) {
    const group = normalizeGroupName(groupName);
    const subgroup = normalizeSubgroupName(subgroupName);
    if (!subgroup) return { ok: false, reason: "Select a subgroup to remove." };
    const config = this.readSubgroups();
    const entry = config.groups.find((item) => lowerKey(item.group) === lowerKey(group));
    if (!entry || !entry.subgroups.some((name) => lowerKey(name) === lowerKey(subgroup))) {
      return { ok: false, reason: "That subgroup no longer exists." };
    }
    entry.subgroups = entry.subgroups.filter((name) => lowerKey(name) !== lowerKey(subgroup));
    config.groups = config.groups.filter((item) => item.subgroups.length);
    const stations = this.readStations().map((station) => (
      lowerKey(station.group) === lowerKey(group) && lowerKey(station.subgroup) === lowerKey(subgroup)
        ? { ...station, subgroup: "" } : station
    ));
    this.writeStations(stations);
    this.writeSubgroups(config);
    return { ok: true, stations: this.readStations(), subgroups: this.readSubgroups() };
  }

  #initializeLibraryAndPreferences() {
    const bundled = path.join(this.defaultsDir, LIBRARY_FILE);
    const defaultLibrary = fs.existsSync(bundled)
      ? validateLibrary(JSON.parse(fs.readFileSync(bundled, "utf8")))
      : validateLibrary({ version: 1, stations: [], groups: ["Other"], subgroups: null });
    let seedStarterPresets = false;
    if (!fs.existsSync(this.getLibraryPath())) {
      const legacyStationsPath = path.join(this.dataDir, LEGACY_FILES[0]);
      if (fs.existsSync(legacyStationsPath)) {
        const defaultStations = defaultLibrary.stations.map((station) => cleanStation({
          ...station,
          favorite: false,
          preset: false,
          presetOrder: null
        }));
        const stations = this.#readLegacyValidated(LEGACY_FILES[0], validateStations, defaultStations);
        const groups = this.#readLegacyValidated(LEGACY_FILES[1], validateGroups, defaultLibrary.groups);
        const subgroups = this.#readLegacyValidated(LEGACY_FILES[2], validateSubgroups, defaultLibrary.subgroups);
        const library = validateLibrary({
          version: 1,
          stations,
          groups,
          subgroups
        });
        this.#atomicWrite(LIBRARY_FILE, library, { createBackup: false });
        if (!fs.existsSync(this.getPreferencesPath())) {
          this.#atomicWrite(PREFERENCES_FILE, preferencesFromStations(stations), { createBackup: false });
        }
        this.#archiveLegacyFiles();
      } else {
        this.#atomicWrite(LIBRARY_FILE, defaultLibrary, { createBackup: false });
        seedStarterPresets = true;
      }
    }
    if (!fs.existsSync(this.getPreferencesPath())) {
      const initialPreferences = seedStarterPresets
        ? starterPreferences(defaultLibrary.stations)
        : validatePreferences(null);
      this.#atomicWrite(PREFERENCES_FILE, initialPreferences, { createBackup: false });
    }
  }

  #archiveLegacyFiles() {
    for (const fileName of LEGACY_FILES) {
      const source = path.join(this.dataDir, fileName);
      if (!fs.existsSync(source)) continue;
      let destination = path.join(this.backupDir, `pre-v0.4-${fileName}`);
      if (fs.existsSync(destination)) destination = path.join(this.backupDir, `pre-v0.4-${Date.now()}-${fileName}`);
      try { fs.renameSync(source, destination); }
      catch (error) {
        this.onWarning(`WaveDeck migrated ${fileName}, but could not archive the old copy: ${error.message}`);
      }
    }
  }

  #readLegacyValidated(fileName, validator, fallback) {
    const candidates = [
      path.join(this.dataDir, fileName),
      path.join(this.backupDir, `${fileName}.bak`)
    ];
    let lastError = null;
    for (const [index, candidate] of candidates.entries()) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const value = validator(JSON.parse(fs.readFileSync(candidate, "utf8")));
        if (index === 1) this.onWarning(`${fileName} was damaged and its backup was used during migration.`);
        return value;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) this.onWarning(`${fileName} could not be migrated: ${lastError.message}`);
    return fallback;
  }

  #readValidated(fileName, validator, fallback) {
    const target = path.join(this.dataDir, fileName);
    try { return validator(JSON.parse(fs.readFileSync(target, "utf8"))); }
    catch (error) {
      const backup = path.join(this.backupDir, `${fileName}.bak`);
      if (fs.existsSync(backup)) {
        try {
          const recovered = validator(JSON.parse(fs.readFileSync(backup, "utf8")));
          this.#atomicWrite(fileName, recovered, { createBackup: false });
          this.onWarning(`${fileName} was damaged and has been restored from its backup.`);
          return recovered;
        } catch {}
      }
      this.onWarning(`${fileName} could not be read: ${error.message}`);
      return fallback;
    }
  }

  #atomicWrite(fileName, data, { createBackup = true } = {}) {
    const target = path.join(this.dataDir, fileName);
    const temporary = path.join(this.dataDir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
    const backup = path.join(this.backupDir, `${fileName}.bak`);
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    try {
      if (createBackup && fs.existsSync(target)) fs.copyFileSync(target, backup);
      fs.renameSync(temporary, target);
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      throw new Error(`Could not save ${fileName}: ${error.message}`);
    }
  }

  #atomicWriteText(fileName, text, { createBackup = true } = {}) {
    const target = path.join(this.dataDir, fileName);
    const temporary = path.join(this.dataDir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
    const backup = path.join(this.backupDir, `${fileName}.bak`);
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.writeFileSync(temporary, text, "utf8");
    try {
      if (createBackup && fs.existsSync(target)) fs.copyFileSync(target, backup);
      fs.renameSync(temporary, target);
    } catch (error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
      throw new Error(`Could not save ${fileName}: ${error.message}`);
    }
  }
}

module.exports = {
  STARTER_PRESET_NAMES,
  PortableStorage,
  cleanStationGainDb,
  cleanStation,
  ensureOtherLast,
  normalizeGroupName,
  normalizeSubgroupName,
  validateGroups,
  validateLibrary,
  validateListeningHistory,
  validatePreferences,
  validateSubgroups,
  validateStations
};
