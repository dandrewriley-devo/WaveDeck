const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_INTERVAL_MS = 1500;

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// A stable logarithmic scale avoids collapsing every familiar song to 100.
function popularityScore(listeners) {
  const value = Math.log10(Math.max(0, Number(listeners) || 0) + 1) / Math.log10(5_000_001);
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

class LastFmEnricher {
  constructor({ library, getPreferences, fetchImpl, onStatus = () => {}, requestIntervalMs = REQUEST_INTERVAL_MS }) {
    this.library = library;
    this.getPreferences = getPreferences;
    this.fetchImpl = fetchImpl;
    this.onStatus = onStatus;
    this.requestIntervalMs = Math.max(0, Number(requestIntervalMs) || 0);
    this.running = false;
    this.timer = null;
    this.status = { enabled: false, configured: false, processing: false, tracksTotal: 0, tracksCurrent: 0, tracksMatched: 0, queuedAlbums: 0, message: '' };
  }
  preferences() {
    const preferences = this.getPreferences() || {};
    return { enabled: preferences.lastFmEnabled === true, apiKey: String(preferences.lastFmApiKey || '').trim() };
  }
  async refreshStatus(message = this.status.message) {
    let database = {};
    try { if (this.library?.worker) database = await this.library.getLastFmStatus(); } catch {}
    const preferences = this.preferences();
    this.status = { ...this.status, ...database, enabled: preferences.enabled, configured: Boolean(preferences.apiKey), message };
    this.onStatus({ ...this.status });
    return this.status;
  }
  configure() {
    const preferences = this.preferences();
    if (!preferences.enabled || !preferences.apiKey) {
      clearTimeout(this.timer); this.timer = null;
      void this.refreshStatus(preferences.enabled ? 'Add a Last.fm API key to begin refreshing music data.' : 'Last.fm music data is off.');
      return;
    }
    this.schedule(500);
  }
  schedule(delay = this.requestIntervalMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delay);
  }
  async queueAlbum(trackId) {
    if (!this.preferences().enabled || !this.preferences().apiKey || !trackId) return;
    await this.library.queueLastFmAlbum(trackId);
    await this.refreshStatus('Refreshing the current album when the background queue reaches it.');
    this.schedule(100);
  }
  async queueFullRefresh() {
    const preferences = this.preferences();
    if (!preferences.enabled) throw new Error('Turn on Improve Music Data with Last.fm first.');
    if (!preferences.apiKey) throw new Error('Add a Last.fm API key first.');
    await this.library.queueFullLastFmRefresh();
    await this.refreshStatus('Full Last.fm refresh queued.');
    this.schedule(100);
    return this.status;
  }
  async testConnection() {
    const preferences = this.preferences();
    if (!preferences.enabled) throw new Error('Turn on Improve Music Data with Last.fm first.');
    if (!preferences.apiKey) throw new Error('Add a Last.fm API key first.');
    await this.request('artist.getInfo', { artist: 'Cher' });
    await this.refreshStatus('Last.fm connection successful.');
    this.configure();
    return this.status;
  }
  async request(method, parameters) {
    const { apiKey } = this.preferences();
    const query = new URLSearchParams({ method, api_key: apiKey, format: 'json', autocorrect: '0', ...parameters });
    const response = await this.fetchImpl(`https://ws.audioscrobbler.com/2.0/?${query}`);
    if (!response?.ok) throw new Error(`Last.fm returned ${response?.status || 'a network error'}.`);
    const payload = await response.json();
    if (payload?.error) {
      const error = new Error(String(payload.message || 'Last.fm could not find this item.'));
      error.notFound = Number(payload.error) === 6;
      throw error;
    }
    return payload;
  }
  async updateTrack(track) {
    const at = new Date().toISOString();
    const base = { id: track.id, artist: track.artist, title: track.title, albumKey: normalize(track.albumArtist || track.artist) + '\n' + normalize(track.album || track.title), lastAttemptAt: at };
    try {
      const payload = await this.request('track.getInfo', { artist: track.artist, track: track.title });
      const remote = payload.track || {};
      const tags = Array.isArray(remote.toptags?.tag)
        ? remote.toptags.tag.map(tag => typeof tag === 'string' ? tag : tag.name).filter(Boolean).slice(0, 8)
        : [];
      const value = { ...base, listeners: Number(remote.listeners) || 0, playCount: Number(remote.playcount) || 0, popularity: popularityScore(remote.listeners), tags, updatedAt: at, retryAfter: '', status: 'matched' };
      await this.library.updateLastFmTrack(value); this.library.applyLastFmTrack(value);
    } catch (error) {
      const retryAfter = new Date(Date.now() + (error.notFound ? SIX_MONTHS_MS : RETRY_MS)).toISOString();
      await this.library.updateLastFmTrack({ ...base, listeners: 0, playCount: 0, popularity: null, tags: [], updatedAt: '', retryAfter, status: error.notFound ? 'not-found' : 'retry' });
    }
  }
  async updateArtist(artist) {
    const at = new Date().toISOString();
    const base = { artist, lastAttemptAt: at };
    try {
      const payload = await this.request('artist.getSimilar', { artist, limit: '20' });
      const similar = Array.isArray(payload.similarartists?.artist) ? payload.similarartists.artist.map(value => typeof value === 'string' ? value : value.name) : [];
      const value = { ...base, similarArtists: similar, updatedAt: at, retryAfter: '', status: 'matched' };
      await this.library.updateLastFmArtist(value); this.library.applyLastFmArtist(value);
    } catch (error) {
      const retryAfter = new Date(Date.now() + (error.notFound ? SIX_MONTHS_MS : RETRY_MS)).toISOString();
      await this.library.updateLastFmArtist({ ...base, similarArtists: [], updatedAt: '', retryAfter, status: error.notFound ? 'not-found' : 'retry' });
    }
  }
  async tick() {
    if (this.running) return;
    const preferences = this.preferences();
    if (!preferences.enabled || !preferences.apiKey) return this.configure();
    if (!this.library?.enabled) { await this.refreshStatus('Open Music to begin the Last.fm background refresh.'); return; }
    this.running = true;
    try {
      await this.refreshStatus('Last.fm is checking music data in the background.');
      const batch = await this.library.nextLastFmAlbum();
      if (!batch) { await this.refreshStatus('Music data is up to date.'); return; }
      const items = [
        ...batch.tracks.map(track => () => this.updateTrack(track)),
        ...batch.artists.map(artist => () => this.updateArtist(artist))
      ];
      for (const item of items) {
        if (!this.preferences().enabled || !this.preferences().apiKey) break;
        await item();
        await pause(this.requestIntervalMs);
      }
      if (batch.queued) await this.library.completeLastFmAlbum(batch.albumKey);
      await this.refreshStatus('Last.fm is refreshing music data in the background.');
    } catch (error) {
      await this.refreshStatus(`Last.fm refresh paused: ${error.message}`);
      this.schedule(RETRY_MS);
      return;
    } finally { this.running = false; }
    this.schedule();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { LastFmEnricher, popularityScore, SIX_MONTHS_MS, RETRY_MS };
