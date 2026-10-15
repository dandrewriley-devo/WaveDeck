// A private, unlisted Icecast mount driven by WaveDeck's own PulseAudio bus.
// This is Linux-only; no desktop audio or other applications enter the bus.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const exec = promisify(execFile);
const PORT = 18037;
const random = () => crypto.randomBytes(24).toString('hex');
const xml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]));

function localAddress() {
  try {
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const item of addresses || []) if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  } catch {}
  return '';
}

function validHost(host) {
  return /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\d{1,3}(?:\.\d{1,3}){3})$/i.test(host)
    && !host.includes('..') && !host.startsWith('-');
}

function validMountName(name) {
  return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(name);
}

function waitForPort(port, child, timeout = 6000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (!child || child.exitCode !== null) return reject(new Error('Icecast stopped before it could start.'));
      const socket = net.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start >= timeout) reject(new Error('Icecast did not open its listening port. Check for another application using port 18037.'));
        else setTimeout(tryConnect, 150);
      });
    };
    tryConnect();
  });
}

class PersonalStream {
  constructor({ dataDir, player, ffmpeg, icecast, icecastLibDir = '', onChanged = () => {}, pactl = 'pactl', captureExecutable = 'parec', spawnImpl = spawn, execImpl = exec }) {
    this.dataDir = dataDir; this.player = player; this.ffmpeg = ffmpeg; this.icecast = icecast;
    this.icecastLibDir = icecastLibDir; this.onChanged = onChanged;
    this.pactl = pactl; this.captureExecutable = captureExecutable; this.spawn = spawnImpl; this.exec = execImpl;
    this.file = path.join(dataDir, 'personal-stream.json');
    this.config = { enabled: false, host: '', token: random(), sourcePassword: random(), adminPassword: random() };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.config = {
        enabled: saved.enabled === true,
        host: validHost(saved.host || '') ? saved.host : '',
        token: validMountName(saved.token) ? saved.token : random(),
        sourcePassword: /^[a-f0-9]{48}$/.test(saved.sourcePassword) ? saved.sourcePassword : random(),
        adminPassword: /^[a-f0-9]{48}$/.test(saved.adminPassword) ? saved.adminPassword : random()
      };
    } catch {}
    this.status = 'off'; this.error = '';
    this.sinkName = `wavedeck_stream_${process.pid}`;
    this.sinkModule = null; this.loopModule = null; this.icecastProcess = null; this.encoder = null; this.capture = null;
    this.operation = Promise.resolve();
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  state() {
    const host = this.config.host || localAddress();
    return {
      enabled: this.config.enabled, status: this.status, error: this.error,
      host: this.config.host, mountName: this.config.token, localHost: localAddress(), port: PORT,
      url: host ? `http://${host}:${PORT}/${this.config.token}.mp3` : '',
      internetReady: Boolean(this.config.host),
      format: '128 kbps MP3'
    };
  }

  changed() { this.onChanged(this.state()); }

  async pactlRun(...args) {
    const { stdout } = await this.exec(this.pactl, args, { timeout: 6000 });
    return String(stdout).trim();
  }

  async monitorVolume(volume, muted) {
    if (this.loopModule === null) return;
    const listing = await this.pactlRun('list', 'sink-inputs');
    const block = listing.split(/(?=Sink Input #)/).find(part => new RegExp(`Owner Module:\\s*${this.loopModule}(?:\\D|$)`).test(part));
    const input = block?.match(/Sink Input #(\d+)/)?.[1];
    if (!input) throw new Error('WaveDeck could not locate its speaker monitor.');
    await this.pactlRun('set-sink-input-volume', input, `${Math.round(volume)}%`);
    await this.pactlRun('set-sink-input-mute', input, muted ? '1' : '0');
  }

  configXml() {
    const dir = xml(this.dataDir);
    const mount = `/${this.config.token}.mp3`;
    return `<?xml version="1.0"?><icecast>
<location>Home</location><admin>local@localhost</admin>
<limits><clients>10</clients><sources>1</sources><queue-size>524288</queue-size><client-timeout>30</client-timeout><header-timeout>15</header-timeout><source-timeout>10</source-timeout></limits>
<authentication><source-password>${xml(this.config.sourcePassword)}</source-password><relay-password>${xml(this.config.sourcePassword)}</relay-password><admin-user>admin</admin-user><admin-password>${xml(this.config.adminPassword)}</admin-password></authentication>
<hostname>localhost</hostname><listen-socket><port>${PORT}</port><bind-address>0.0.0.0</bind-address></listen-socket>
<mount><mount-name>${mount}</mount-name><public>0</public><hidden>1</hidden><stream-name>WaveDeck Personal Radio</stream-name><charset>UTF-8</charset></mount>
<fileserve>0</fileserve><paths><basedir>${dir}</basedir><logdir>${dir}</logdir><webroot>${dir}</webroot><adminroot>${dir}</adminroot></paths>
<logging><accesslog>personal-stream-access.log</accesslog><errorlog>personal-stream-error.log</errorlog><loglevel>2</loglevel></logging>
<security><chroot>0</chroot></security></icecast>`;
  }

  async start() {
    if (this.status === 'broadcasting') return this.state();
    if (process.platform !== 'linux') throw new Error('Personal Stream is available on Linux.');
    this.status = 'starting'; this.error = ''; this.changed();
    try {
      if (!fs.existsSync(this.icecast) || !fs.existsSync(this.ffmpeg)) throw new Error('The bundled streaming tools are missing.');
      const sink = await this.pactlRun('load-module', 'module-null-sink', `sink_name=${this.sinkName}`, 'sink_properties=device.description=WaveDeck-Stream');
      this.sinkModule = Number(sink);
      if (!Number.isInteger(this.sinkModule)) throw new Error('Could not create the isolated WaveDeck audio bus.');
      const speaker = await this.pactlRun('get-default-sink');
      const loop = await this.pactlRun('load-module', 'module-loopback', `source=${this.sinkName}.monitor`, `sink=${speaker}`, 'latency_msec=80');
      this.loopModule = Number(loop);
      if (!Number.isInteger(this.loopModule)) throw new Error('Could not connect WaveDeck to the speakers.');
      await this.player.setBroadcastOutput(this.sinkName, (volume, muted) => this.monitorVolume(volume, muted));

      fs.mkdirSync(this.dataDir, { recursive: true });
      const configPath = path.join(this.dataDir, 'personal-stream-icecast.xml');
      fs.writeFileSync(configPath, this.configXml(), { mode: 0o600 });
      this.icecastProcess = this.spawn(this.icecast, ['-c', configPath], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, ...(this.icecastLibDir ? { LD_LIBRARY_PATH: `${this.icecastLibDir}:${process.env.LD_LIBRARY_PATH || ''}` } : {}) }
      });
      this.icecastProcess.on('error', error => this.fail(error));
      this.icecastProcess.on('exit', code => { if (this.status === 'broadcasting') this.fail(new Error(`Icecast exited (${code}).`)); });
      await waitForPort(PORT, this.icecastProcess);
      const url = `icecast://source:${this.config.sourcePassword}@127.0.0.1:${PORT}/${this.config.token}.mp3`;
      this.capture = this.spawn(this.captureExecutable, [
        '--device', `${this.sinkName}.monitor`, '--format=s16le', '--rate=48000', '--channels=2'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.capture.on('error', error => this.fail(error));
      this.capture.on('exit', code => { if (this.status === 'broadcasting') this.fail(new Error(`Audio capture exited (${code}).`)); });
      this.encoder = this.spawn(this.ffmpeg, [
        '-hide_banner', '-loglevel', 'warning', '-nostdin',
        '-f', 's16le', '-ac', '2', '-ar', '48000', '-i', 'pipe:0',
        '-ac', '2', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '128k',
        '-content_type', 'audio/mpeg', '-f', 'mp3', url
      ], { stdio: ['pipe', 'ignore', 'pipe'] });
      this.capture.stdout.pipe(this.encoder.stdin);
      this.encoder.stdin.on('error', () => {});
      this.encoder.on('error', error => this.fail(error));
      this.encoder.on('exit', code => { if (this.status === 'broadcasting') this.fail(new Error(`Stream encoder exited (${code}).`)); });
      // A local source connection proves encoding actually started, not merely that the server opened.
      await this.waitForSource();
      this.status = 'broadcasting'; this.changed();
      return this.state();
    } catch (error) {
      await this.stopResources();
      this.status = 'error'; this.error = error.message; this.changed();
      throw error;
    }
  }

  async waitForSource() {
    const start = Date.now();
    while (Date.now() - start < 8000) {
      if (this.encoder?.exitCode !== null || this.icecastProcess?.exitCode !== null) throw new Error('Streaming engine exited before it connected.');
      const found = await new Promise(resolve => {
        const req = http.get({ hostname: '127.0.0.1', port: PORT, path: `/${this.config.token}.mp3`, timeout: 1000 }, response => {
          response.destroy(); resolve(response.statusCode === 200);
        });
        req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (found) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Icecast started, but the audio encoder did not connect.');
  }

  fail(error) {
    if (this.status === 'off' || this.status === 'error') return;
    this.status = 'error'; this.error = error.message; this.changed();
    void this.stopResources();
  }

  async stopResources() {
    try { await this.player.setBroadcastOutput(null); } catch {}
    const icecastExited = this.icecastProcess && this.icecastProcess.exitCode === null
      ? new Promise(resolve => {
        const timer = setTimeout(resolve, 2000);
        this.icecastProcess.once('exit', () => { clearTimeout(timer); resolve(); });
      }) : Promise.resolve();
    this.encoder?.kill(); this.encoder = null;
    this.capture?.kill(); this.capture = null;
    this.icecastProcess?.kill(); this.icecastProcess = null;
    await icecastExited;
    if (this.loopModule !== null) { await this.pactlRun('unload-module', String(this.loopModule)).catch(() => {}); this.loopModule = null; }
    if (this.sinkModule !== null) { await this.pactlRun('unload-module', String(this.sinkModule)).catch(() => {}); this.sinkModule = null; }
  }

  setEnabled(enabled) {
    this.operation = this.operation.catch(() => {}).then(async () => {
      this.config.enabled = enabled === true;
      this.save();
      if (this.config.enabled) return this.start();
      await this.stopResources(); this.status = 'off'; this.error = ''; this.changed();
      return this.state();
    });
    return this.operation;
  }

  setHost(value) {
    const host = String(value || '').trim().toLowerCase();
    if (host && !validHost(host)) throw new Error('Enter only an internet hostname or IPv4 address, without http:// or a port.');
    this.config.host = host; this.save(); this.changed(); return this.state();
  }

  setMountName(value) {
    const name = String(value || '').trim().toLowerCase();
    if (!validMountName(name)) throw new Error('Use 1–48 letters, numbers, or hyphens. Start and end with a letter or number.');
    this.operation = this.operation.catch(() => {}).then(async () => {
      if (name === this.config.token) return this.state();
      const restart = this.config.enabled;
      if (restart) { await this.stopResources(); this.status = 'off'; }
      this.config.token = name;
      this.save(); this.changed();
      return restart ? this.start() : this.state();
    });
    return this.operation;
  }

  updateSong(song) {
    if (this.status !== 'broadcasting') return;
    const title = String(song || '').trim().slice(0, 250);
    if (!title) return;
    const query = new URLSearchParams({ mount: `/${this.config.token}.mp3`, mode: 'updinfo', song: title });
    const authorization = 'Basic ' + Buffer.from(`admin:${this.config.adminPassword}`).toString('base64');
    const req = http.get({ hostname: '127.0.0.1', port: PORT, path: `/admin/metadata?${query}`, headers: { Authorization: authorization }, timeout: 2500 }, res => res.resume());
    req.on('error', () => {}); req.on('timeout', () => req.destroy());
  }

  close() { this.status = 'off'; void this.stopResources(); }
}

module.exports = { PersonalStream, validHost, validMountName, PORT };
