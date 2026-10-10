const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LASTFM_API_KEY = 'bcfd159a52580e96ad9cafa6df400a2a';
// This personal WaveDeck Opus build is intentionally allowed to make signed
// Last.fm write requests. Do not reuse this credential in the public build.
const LASTFM_SHARED_SECRET = 'e04a861f780cd64b138a86a1b45af4bc';
const CONNECT_POLL_MS = 2500;
const CONNECT_TIMEOUT_MS = 60 * 60 * 1000;

function cleanText(value, limit = 500) { return String(value || '').trim().slice(0, limit); }
function signatureFor(parameters, secret = LASTFM_SHARED_SECRET) {
  const joined = Object.keys(parameters).sort().map(key => `${key}${parameters[key]}`).join('') + secret;
  return crypto.createHash('md5').update(joined, 'utf8').digest('hex');
}

class LastFmScrobbler {
  constructor({ dataDir, fetchImpl, openExternal = async () => {}, onStatus = () => {}, now = () => Date.now(), pollMs = CONNECT_POLL_MS }) {
    this.file = path.join(dataDir, 'lastfm-scrobbling.json');
    this.fetchImpl = fetchImpl;
    this.openExternal = openExternal;
    this.onStatus = onStatus;
    this.now = now;
    this.pollMs = pollMs;
    this.data = { version: 1, sessionKey: '', username: '', pending: [] };
    this.connecting = false;
    this.connectMessage = '';
    this.connectToken = '';
    this.connectStartedAt = 0;
    this.connectTimer = null;
    this.flushing = false;
    this.active = null;
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const pending = Array.isArray(saved?.pending) ? saved.pending.map(item => this.cleanScrobble(item)).filter(Boolean).slice(-500) : [];
      this.data = { version: 1, sessionKey: /^[a-f0-9]{32}$/i.test(String(saved?.sessionKey || '')) ? String(saved.sessionKey) : '', username: cleanText(saved?.username, 120), pending };
    } catch {}
  }

  save() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data) + '\n', 'utf8'); fs.renameSync(`${this.file}.tmp`, this.file); } catch {}
  }

  cleanScrobble(value) {
    const artist = cleanText(value?.artist); const track = cleanText(value?.track); const timestamp = Math.floor(Number(value?.timestamp) || 0);
    if (!artist || !track || timestamp < 1) return null;
    return { artist, track, timestamp, album: cleanText(value?.album), albumArtist: cleanText(value?.albumArtist), trackNumber: Math.max(0, Math.floor(Number(value?.trackNumber) || 0)), duration: Math.max(0, Math.floor(Number(value?.duration) || 0)) };
  }

  getStatus() { return { connected: Boolean(this.data.sessionKey), username: this.data.username, pending: this.data.pending.length, connecting: this.connecting, message: this.connectMessage }; }
  emit() { this.onStatus(this.getStatus()); return this.getStatus(); }

  async request(method, parameters = {}, { post = false } = {}) {
    const values = { method, api_key: LASTFM_API_KEY, ...parameters };
    values.api_sig = signatureFor(values); values.format = 'json';
    const encoded = new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
    const response = post ? await this.fetchImpl('https://ws.audioscrobbler.com/2.0/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: encoded.toString() }) : await this.fetchImpl(`https://ws.audioscrobbler.com/2.0/?${encoded}`);
    if (!response?.ok) throw new Error(`Last.fm returned ${response?.status || 'a network error'}.`);
    const payload = await response.json();
    if (payload?.error) { const error = new Error(String(payload.message || 'Last.fm could not complete that request.')); error.code = Number(payload.error) || 0; throw error; }
    return payload;
  }

  async connect() {
    if (this.connecting) return this.getStatus();
    const payload = await this.request('auth.getToken'); const token = cleanText(payload?.token, 80);
    if (!token) throw new Error('Last.fm did not return an authorization token.');
    this.connecting = true; this.connectToken = token; this.connectStartedAt = this.now(); this.connectMessage = 'Finish connecting in your browser.'; this.emit();
    try {
      await this.openExternal(`https://www.last.fm/api/auth/?${new URLSearchParams({ api_key: LASTFM_API_KEY, token })}`);
    } catch (error) {
      this.stopConnecting(`Could not open Last.fm: ${error.message}`);
      throw error;
    }
    this.connectTimer = setInterval(() => { void this.finishConnect(); }, this.pollMs); this.connectTimer.unref?.(); void this.finishConnect();
    return this.getStatus();
  }

  async finishConnect() {
    if (!this.connecting || !this.connectToken) return;
    if (this.now() - this.connectStartedAt > CONNECT_TIMEOUT_MS) return this.stopConnecting('Last.fm connection timed out.');
    try {
      const payload = await this.request('auth.getSession', { token: this.connectToken });
      const sessionKey = cleanText(payload?.session?.key, 80); const username = cleanText(payload?.session?.name, 120);
      if (!sessionKey || !username) throw new Error('Last.fm did not return a usable session.');
      this.data.sessionKey = sessionKey; this.data.username = username; this.save(); this.stopConnecting(`Connected as ${username}.`); void this.flush();
    } catch (error) {
      if ([4, 14].includes(error.code)) return;
      this.stopConnecting(`Could not connect Last.fm: ${error.message}`);
    }
  }

  stopConnecting(message = '') { clearInterval(this.connectTimer); this.connectTimer = null; this.connecting = false; this.connectToken = ''; this.connectStartedAt = 0; this.connectMessage = message; this.emit(); }
  disconnect() { this.stopConnecting('Last.fm disconnected.'); this.data = { version: 1, sessionKey: '', username: '', pending: [] }; this.active = null; this.save(); return this.emit(); }

  trackStarted(track) {
    if (!this.data.sessionKey || !track?.artist || !track?.title) return;
    const timestamp = Math.floor(this.now() / 1000);
    this.active = { key: String(track.songKey || track.id || `${track.artist}\n${track.title}`), track: this.cleanScrobble({ artist: track.artist, track: track.title, timestamp, album: track.album, albumArtist: track.albumArtist, trackNumber: track.track, duration: track.duration }), submitted: false };
    if (this.active.track) void this.nowPlaying(this.active.track);
  }

  async nowPlaying(item) {
    try {
      const parameters = { artist: item.artist, track: item.track, sk: this.data.sessionKey };
      if (item.album) parameters.album = item.album; if (item.albumArtist) parameters.albumArtist = item.albumArtist; if (item.trackNumber) parameters.trackNumber = item.trackNumber; if (item.duration) parameters.duration = item.duration;
      await this.request('track.updateNowPlaying', parameters, { post: true });
    } catch {}
  }

  observe(status = {}) {
    if (!this.active || this.active.submitted || status?.mediaState !== 'playing') return;
    const current = status?.currentMusic?.track; const currentKey = String(current?.songKey || current?.id || '');
    if (!currentKey || currentKey !== this.active.key) return;
    const duration = Math.max(0, Number(status.duration || current.duration) || 0); const position = Math.max(0, Number(status.position) || 0);
    const threshold = Math.max(30, duration > 0 ? Math.min(duration / 2, 240) : 240);
    if (position >= threshold) { this.active.submitted = true; this.enqueue(this.active.track); }
  }

  enqueue(item) {
    const clean = this.cleanScrobble(item); if (!clean) return;
    const duplicate = this.data.pending.some(other => other.timestamp === clean.timestamp && other.artist === clean.artist && other.track === clean.track);
    if (!duplicate) { this.data.pending.push(clean); this.data.pending = this.data.pending.slice(-500); this.save(); this.emit(); }
    void this.flush();
  }

  async flush() {
    if (this.flushing || !this.data.sessionKey || !this.data.pending.length) return;
    this.flushing = true;
    try {
      while (this.data.pending.length && this.data.sessionKey) {
        const item = this.data.pending[0]; const parameters = { artist: item.artist, track: item.track, timestamp: item.timestamp, sk: this.data.sessionKey };
        if (item.album) parameters.album = item.album; if (item.albumArtist) parameters.albumArtist = item.albumArtist; if (item.trackNumber) parameters.trackNumber = item.trackNumber; if (item.duration) parameters.duration = item.duration;
        await this.request('track.scrobble', parameters, { post: true }); this.data.pending.shift(); this.save(); this.connectMessage = ''; this.emit();
      }
    } catch (error) {
      if (error.code === 9) { this.data.sessionKey = ''; this.data.username = ''; this.save(); this.connectMessage = 'Last.fm needs to be connected again.'; }
      else this.connectMessage = 'Scrobbles are queued until Last.fm is reachable.';
      this.emit();
    } finally { this.flushing = false; }
  }

  stop() { this.stopConnecting(this.connectMessage); }
}

module.exports = { LastFmScrobbler, signatureFor };
