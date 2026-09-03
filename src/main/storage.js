const fs = require("fs");
const path = require("path");

const STATIONS_FILE = "stations.json";
const GROUPS_FILE = "groups.json";
const SUBGROUPS_FILE = "subgroups.json";
const NOTEPAD_FILE = "notepad.txt";
const LISTENING_HISTORY_FILE = "listening-history.json";

function validateListeningHistory(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.stations
    : null;
  const stations = {};
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [rawId, rawEntry] of Object.entries(source)) {
      const id = String(rawId ?? "").trim();
      if (!id || !rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;
      const seconds = Math.max(0, Math.floor(Number(rawEntry.seconds) || 0));
      if (!seconds) continue;
      stations[id] = {
        seconds,
        lastListenedAt: typeof rawEntry.lastListenedAt === "string"
          ? rawEntry.lastListenedAt
          : ""
      };
    }
  }
  return { version: 1, stations };
}

function lowerKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeGroupName(value) {
  const name = String(value ?? "").trim();
  return name || "Other";
}

function normalizeSubgroupName(value) {
  return String(value ?? "").trim();
}

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

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cleanStation(raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Station ${index + 1} is not an object.`);
  }

  const name = String(raw.name ?? "").trim();
  const url = String(raw.url ?? "").trim();
  if (!name || !url) {
    throw new Error(`Station ${index + 1} must have a name and URL.`);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Station ${index + 1} has an invalid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Station ${index + 1} must use an HTTP or HTTPS URL.`);
  }

  // Before v0.2.3, `favorite` represented the quick-access list that is now
  // called Presets. The presence of the new `preset` field is our unambiguous
  // schema marker: legacy favorites become presets, while the new independent
  // Favorite flag starts clear. Legacy noPreRoll=true is intentionally not
  // inverted into an ad warning.
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
    hasPreRoll: currentSchema && Boolean(raw.hasPreRoll)
  };
}

function validateStations(values) {
  if (!Array.isArray(values)) {
    throw new Error("Station data must be a JSON array.");
  }

  const stations = values.map(cleanStation);
  const ids = new Set();
  for (const station of stations) {
    if (ids.has(station.id)) {
      throw new Error(`Duplicate station ID: ${station.id}`);
    }
    ids.add(station.id);
  }
  return stations;
}

function validateGroups(values) {
  if (!Array.isArray(values)) {
    throw new Error("Group data must be a JSON array.");
  }
  return ensureOtherLast(values);
}

function validateSubgroups(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.groups
    : null;
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
    this.#initializeFile(STATIONS_FILE, []);
    this.#migrateStationSchema();
    this.#initializeFile(GROUPS_FILE, ["Other"]);
    if (!fs.existsSync(this.getSubgroupsPath())) {
      const bundled = path.join(this.defaultsDir, SUBGROUPS_FILE);
      const initial = fs.existsSync(bundled)
        ? validateSubgroups(JSON.parse(fs.readFileSync(bundled, "utf8")))
        : validateSubgroups(null);
      this.#atomicWrite(SUBGROUPS_FILE, initial, { createBackup: false });
    }
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

  getStationsPath() {
    return path.join(this.dataDir, STATIONS_FILE);
  }

  getGroupsPath() {
    return path.join(this.dataDir, GROUPS_FILE);
  }

  getNotepadPath() {
    return path.join(this.dataDir, NOTEPAD_FILE);
  }

  getSubgroupsPath() {
    return path.join(this.dataDir, SUBGROUPS_FILE);
  }

  getListeningHistoryPath() {
    return path.join(this.dataDir, LISTENING_HISTORY_FILE);
  }

  readStations() {
    return this.#readValidated(STATIONS_FILE, validateStations, []);
  }

  writeStations(values) {
    const stations = validateStations(values);
    this.#atomicWrite(STATIONS_FILE, stations);
    return stations;
  }

  readGroups() {
    return this.#readValidated(GROUPS_FILE, validateGroups, ["Other"]);
  }

  writeGroups(values) {
    const groups = validateGroups(values);
    this.#atomicWrite(GROUPS_FILE, groups);
    return groups;
  }

  readSubgroups() {
    return this.#readValidated(SUBGROUPS_FILE, validateSubgroups, validateSubgroups(null));
  }

  writeSubgroups(value) {
    const subgroups = validateSubgroups(value);
    this.#atomicWrite(SUBGROUPS_FILE, subgroups);
    return subgroups;
  }

  readNotepad() {
    try {
      return fs.readFileSync(this.getNotepadPath(), "utf8");
    } catch (error) {
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
    return this.#readValidated(
      LISTENING_HISTORY_FILE,
      validateListeningHistory,
      validateListeningHistory(null)
    );
  }

  writeListeningHistory(value) {
    const history = validateListeningHistory(value);
    this.#atomicWrite(LISTENING_HISTORY_FILE, history);
    return history;
  }

  syncGroupsWithStations(stations) {
    const groups = this.readGroups();
    const keys = new Set(groups.map(lowerKey));
    const additions = [];

    for (const station of stations) {
      const group = normalizeGroupName(station.group);
      const key = lowerKey(group);
      if (key !== "other" && !keys.has(key)) {
        keys.add(key);
        additions.push(group);
      }
    }

    if (!additions.length) return groups;
    return this.writeGroups([...groups.filter((g) => lowerKey(g) !== "other"), ...additions, "Other"]);
  }

  syncSubgroupsWithStations(stations) {
    const config = this.readSubgroups();
    const entries = config.groups.map((entry) => ({
      group: entry.group,
      subgroups: [...entry.subgroups]
    }));

    for (const station of stations) {
      const subgroup = normalizeSubgroupName(station.subgroup);
      if (!subgroup) continue;
      const group = normalizeGroupName(station.group);
      let entry = entries.find((item) => lowerKey(item.group) === lowerKey(group));
      if (!entry) {
        entry = { group, subgroups: [] };
        entries.push(entry);
      }
      if (!entry.subgroups.some((name) => lowerKey(name) === lowerKey(subgroup))) {
        entry.subgroups.push(subgroup);
      }
    }

    const next = validateSubgroups({ version: 1, groups: entries });
    if (JSON.stringify(next) === JSON.stringify(config)) return config;
    return this.writeSubgroups(next);
  }

  saveSubgroups(value) {
    return this.writeSubgroups(value);
  }

  removeGroup(groupName) {
    const target = normalizeGroupName(groupName);
    if (lowerKey(target) === "other") {
      return { ok: false, reason: "The Other group cannot be removed." };
    }

    const stations = this.readStations().map((station) =>
      lowerKey(station.group) === lowerKey(target)
        ? { ...station, group: "Other", subgroup: "" }
        : station
    );
    const groups = this.readGroups().filter((group) => lowerKey(group) !== lowerKey(target));
    const subgroups = this.readSubgroups();
    subgroups.groups = subgroups.groups.filter((entry) => lowerKey(entry.group) !== lowerKey(target));

    this.writeStations(stations);
    this.writeGroups(groups);
    this.writeSubgroups(subgroups);
    return { ok: true, stations, groups: ensureOtherLast(groups) };
  }

  renameSubgroup(groupName, oldName, newName) {
    const group = normalizeGroupName(groupName);
    const oldSubgroup = normalizeSubgroupName(oldName);
    const nextSubgroup = normalizeSubgroupName(newName);
    if (!oldSubgroup || !nextSubgroup) {
      return { ok: false, reason: "Subgroup names cannot be empty." };
    }

    const config = this.readSubgroups();
    const entry = config.groups.find((item) => lowerKey(item.group) === lowerKey(group));
    if (!entry || !entry.subgroups.some((name) => lowerKey(name) === lowerKey(oldSubgroup))) {
      return { ok: false, reason: "That subgroup no longer exists." };
    }
    if (entry.subgroups.some((name) => (
      lowerKey(name) === lowerKey(nextSubgroup) && lowerKey(name) !== lowerKey(oldSubgroup)
    ))) {
      return { ok: false, reason: "That subgroup name is already in use." };
    }

    entry.subgroups = entry.subgroups.map((name) => (
      lowerKey(name) === lowerKey(oldSubgroup) ? nextSubgroup : name
    ));
    const stations = this.readStations().map((station) => (
      lowerKey(station.group) === lowerKey(group) &&
      lowerKey(station.subgroup) === lowerKey(oldSubgroup)
        ? { ...station, subgroup: nextSubgroup }
        : station
    ));
    this.writeStations(stations);
    this.writeSubgroups(config);
    return { ok: true, stations, subgroups: this.readSubgroups() };
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
      lowerKey(station.group) === lowerKey(group) &&
      lowerKey(station.subgroup) === lowerKey(subgroup)
        ? { ...station, subgroup: "" }
        : station
    ));
    this.writeStations(stations);
    this.writeSubgroups(config);
    return { ok: true, stations, subgroups: this.readSubgroups() };
  }

  #initializeFile(fileName, fallback) {
    const target = path.join(this.dataDir, fileName);
    if (fs.existsSync(target)) return;

    const bundled = path.join(this.defaultsDir, fileName);
    if (fs.existsSync(bundled)) {
      const data = JSON.parse(fs.readFileSync(bundled, "utf8"));
      const validated = fileName === STATIONS_FILE
        ? validateStations(data)
        : validateGroups(data);
      this.#atomicWrite(fileName, validated, { createBackup: false });
      return;
    }

    this.#atomicWrite(fileName, fallback, { createBackup: false });
  }

  #migrateStationSchema() {
    const target = this.getStationsPath();
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(target, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(raw)) return;
    const needsMigration = raw.some((station) => (
      station && typeof station === "object" && !Array.isArray(station) &&
      (!hasOwn(station, "preset") || hasOwn(station, "favoriteOrder") || hasOwn(station, "noPreRoll"))
    ));
    if (!needsMigration) return;
    this.#atomicWrite(STATIONS_FILE, validateStations(raw));
  }

  #readValidated(fileName, validator, fallback) {
    const target = path.join(this.dataDir, fileName);
    try {
      return validator(JSON.parse(fs.readFileSync(target, "utf8")));
    } catch (error) {
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
      if (createBackup && fs.existsSync(target)) {
        fs.copyFileSync(target, backup);
      }
      fs.renameSync(temporary, target);
    } catch (error) {
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch {}
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
      try {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      } catch {}
      throw new Error(`Could not save ${fileName}: ${error.message}`);
    }
  }
}

module.exports = {
  PortableStorage,
  cleanStation,
  ensureOtherLast,
  normalizeGroupName,
  normalizeSubgroupName,
  validateGroups,
  validateListeningHistory,
  validateSubgroups,
  validateStations
};
