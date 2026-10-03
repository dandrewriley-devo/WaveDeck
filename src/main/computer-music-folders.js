const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE_NAME = 'computer-music-folders.json';
const cleanFolder = value => typeof value === 'string' ? value.trim().slice(0, 4096) : '';
const cleanLabel = value => String(value || '').replace(/[\u0000\r\n]/g, ' ').trim().slice(0, 120);

function resolveComputerIdentity({ platform = process.platform, hostname = os.hostname(), readFile = fs.readFileSync } = {}) {
  let source = `${platform}:${hostname}`;
  if (platform === 'linux') {
    try {
      const machineId = String(readFile('/etc/machine-id', 'utf8') || '').trim();
      if (machineId) source = `${platform}:${machineId}`;
    } catch {}
  }
  return {
    id: crypto.createHash('sha256').update(source).digest('hex').slice(0, 32),
    label: cleanLabel(hostname) || 'this computer'
  };
}

class ComputerMusicFolders {
  constructor({ dataDir }) { this.filePath = path.join(dataDir, FILE_NAME); this.data = { version: 1, computers: {} }; }
  initialize() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.computers && typeof parsed.computers === 'object' && !Array.isArray(parsed.computers)) {
        for (const [id, value] of Object.entries(parsed.computers)) {
          const folder = cleanFolder(value?.folder);
          if (/^[a-f0-9]{32}$/.test(id) && folder) this.data.computers[id] = { folder, label: cleanLabel(value?.label) };
        }
      }
    } catch {}
  }
  get(id) { const entry = this.data.computers[String(id || '')]; return entry ? { ...entry } : null; }
  list() {
    return Object.entries(this.data.computers)
      .map(([id, entry]) => ({ id, folder: entry.folder, label: entry.label || 'Unnamed computer' }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
  }
  remember({ id, label, folder }) {
    const computerId = String(id || ''); const clean = cleanFolder(folder);
    if (!/^[a-f0-9]{32}$/.test(computerId) || !clean) throw new Error('That computer music folder is not valid.');
    const existing = this.data.computers[computerId];
    this.data.computers[computerId] = { folder: clean, label: cleanLabel(label) || existing?.label || '' };
    this.#write(); return this.get(computerId);
  }
  rename(id, label) {
    const computerId = String(id || '');
    const entry = this.data.computers[computerId];
    const clean = cleanLabel(label);
    if (!entry) throw new Error('That remembered computer is no longer available.');
    if (!clean) throw new Error('Give this computer a name first.');
    entry.label = clean;
    this.#write(); return this.get(computerId);
  }
  forget(id) { delete this.data.computers[String(id || '')]; this.#write(); }
  #write() {
    const directory = path.dirname(this.filePath); fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`; fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2)); fs.renameSync(temporary, this.filePath);
  }
}

module.exports = { ComputerMusicFolders, FILE_NAME, resolveComputerIdentity };
