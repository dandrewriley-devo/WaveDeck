const $ = id => document.getElementById(id);
const content = $('content');
const search = $('search');
const summary = $('summary');
const ROW_HEIGHT = 49;
const LOADING_DETAIL_HEIGHT = 62;
let artists = [], query = '', activeArtist = '', detail = null, activeRelease = '', editingTrack = '', playingTrack = '';
let expandedDetailHeight = 0, viewport = null, searchTimer = 0;

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const duration = seconds => { const whole = Math.max(0, Math.round(Number(seconds) || 0)); return whole ? `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}` : '—'; };
const currentScroll = () => viewport?.isConnected ? viewport.scrollTop : 0;

function expandedHeight() {
  if (!activeArtist) return 0;
  if (!detail) return LOADING_DETAIL_HEIGHT;
  const release = detail.releases.find(value => value.key === activeRelease);
  return expandedDetailHeight || (98 + detail.releases.length * 43 + (release ? release.tracks.length * 39 + (editingTrack ? 60 : 0) : 0));
}
async function loadArtists({ keepOpen = false } = {}) {
  const scrollTop = currentScroll();
  artists = await window.wavedeck.getPortableMusicArtists(query);
  if (!keepOpen || !artists.some(artist => artist.key === activeArtist)) { activeArtist = ''; detail = null; activeRelease = ''; editingTrack = ''; expandedDetailHeight = 0; }
  summary.textContent = `${artists.length.toLocaleString()} artists in Portable Music`;
  render(scrollTop);
}
async function openArtist(key) {
  const scrollTop = currentScroll();
  if (activeArtist === key) { activeArtist = ''; detail = null; activeRelease = ''; editingTrack = ''; expandedDetailHeight = 0; render(scrollTop); return; }
  activeArtist = key; activeRelease = ''; editingTrack = ''; detail = null; expandedDetailHeight = 0; render(scrollTop);
  try { detail = await window.wavedeck.getPortableMusicArtistDetail(key, query); expandedDetailHeight = 0; render(scrollTop); }
  catch (error) { activeArtist = ''; detail = null; expandedDetailHeight = 0; summary.textContent = error.message; render(scrollTop); }
}
async function refreshDetail() {
  if (!activeArtist) return loadArtists();
  const scrollTop = currentScroll(); detail = await window.wavedeck.getPortableMusicArtistDetail(activeArtist, query); expandedDetailHeight = 0; render(scrollTop);
}
function updateRatedSummary(before, after) {
  const artist = artists.find(value => value.key === activeArtist); if (!artist) return;
  const wasRated = Number(before.rating) > 0, isRated = Number(after.rating) > 0;
  if (wasRated === isRated) return;
  artist.ratedCount = Math.max(0, (Number(artist.ratedCount) || 0) + (isRated ? 1 : -1));
  artist.ratedPercent = artist.trackCount ? Math.round((artist.ratedCount / artist.trackCount) * 100) : 0;
}
function applyTrackPatch(track, patch) {
  const next = { ...track, ...patch };
  for (const release of detail?.releases || []) { const index = release.tracks.findIndex(value => value.id === track.id); if (index >= 0) release.tracks[index] = next; }
  updateRatedSummary(track, next); return next;
}
async function saveTrack(track, patch) {
  const scrollTop = currentScroll(), next = applyTrackPatch(track, patch); editingTrack = ''; render(scrollTop);
  try { await window.wavedeck.savePortableMusicTrack({ id: track.id, ...patch }); }
  catch (error) { applyTrackPatch(next, track); summary.textContent = error.message; render(scrollTop); }
}
function smallButton(label, title, action, className = '') {
  const button = document.createElement('button'); button.className = `icon-button ${className}`; button.textContent = label; button.title = title;
  button.onclick = event => { event.stopPropagation(); void action(); }; return button;
}
function ratingControls(track) {
  const controls = document.createElement('div'); controls.className = 'rating-controls';
  controls.append(smallButton('⊘', 'Do Not Play', () => saveTrack(track, { doNotPlay: !track.doNotPlay }), track.doNotPlay ? 'on-ban' : ''));
  const stars = document.createElement('div'); stars.className = 'stars';
  for (let value = 1; value <= 10; value += 1) stars.append(smallButton('★', `Rate ${value} of 10`, () => saveTrack(track, { rating: Number(track.rating) === value ? 0 : value }), Number(track.rating) >= value ? 'on-star' : ''));
  controls.append(stars, smallButton(track.favorite ? '♥' : '♡', 'Favorite', () => saveTrack(track, { favorite: !track.favorite }), track.favorite ? 'on-heart' : ''));
  return controls;
}
function trackEditor(track) {
  const editor = document.createElement('form'); editor.className = 'track-editor';
  editor.innerHTML = `<label>Title <input name="title" value="${esc(track.title)}"></label><label>Artist <input name="artist" value="${esc(track.artist)}"></label><label>Release <input name="album" value="${esc(track.album || '')}"></label><button>Save details</button><button type="button">Cancel</button>`;
  editor.onsubmit = event => { event.preventDefault(); void saveTrack(track, { title: editor.elements.title.value, artist: editor.elements.artist.value, album: editor.elements.album.value }); };
  editor.querySelector('[type="button"]').onclick = () => { editingTrack = ''; expandedDetailHeight = 0; render(currentScroll()); };
  return editor;
}
function trackRow(track) {
  const wrap = document.createElement('div'); wrap.className = 'track-wrap'; const row = document.createElement('div'); row.className = `track-row${track.doNotPlay ? ' disabled-track' : ''}`;
  row.append(smallButton(playingTrack === track.id ? '●' : '▶', 'Play this track now', async () => { playingTrack = track.id; render(currentScroll()); await window.wavedeck.playMusic(track.id, 'song'); }));
  const number = document.createElement('span'); number.className = 'track-number'; number.textContent = track.track ? String(track.track) : '—'; row.append(number);
  const title = document.createElement('button'); title.className = 'track-title'; title.textContent = track.title || 'Untitled track'; title.title = 'Edit track details';
  title.onclick = () => { editingTrack = editingTrack === track.id ? '' : track.id; expandedDetailHeight = 0; render(currentScroll()); }; row.append(title);
  const time = document.createElement('span'); time.className = 'track-time'; time.textContent = duration(track.duration); row.append(time);
  const popularity = document.createElement('span'); popularity.className = 'track-popularity'; popularity.title = 'Last.fm popularity'; popularity.textContent = Number.isFinite(Number(track.popularity)) ? Math.round(Number(track.popularity)) : '—'; row.append(popularity, ratingControls(track));
  wrap.append(row); if (editingTrack === track.id) wrap.append(trackEditor(track)); return wrap;
}
function relatedEditor() {
  const box = document.createElement('div'); box.className = 'related-row'; const lastfm = detail.lastFmRelated.length ? detail.lastFmRelated.join(' · ') : 'No Last.fm related artists yet';
  box.innerHTML = `<div><b>Related artists</b><span class="lastfm-related">Last.fm: ${esc(lastfm)}</span></div>`;
  const manual = document.createElement('div'); manual.className = 'manual-related';
  for (const artist of detail.manualRelated) { const chip = document.createElement('span'); chip.className = 'related-chip'; chip.textContent = artist; chip.append(smallButton('×', `Remove ${artist}`, async () => { await window.wavedeck.saveArtistRelationships(detail.artist, detail.manualRelated.filter(value => value !== artist)); await refreshDetail(); })); manual.append(chip); }
  const form = document.createElement('form'); form.className = 'add-related'; form.innerHTML = '<input placeholder="Add a related artist" aria-label="Add a related artist"><button>Add</button>';
  form.onsubmit = async event => { event.preventDefault(); const value = form.querySelector('input').value.trim(); if (!value) return; await window.wavedeck.saveArtistRelationships(detail.artist, [...detail.manualRelated, value]); await refreshDetail(); };
  box.append(manual, form); return box;
}
function artistDetail() {
  const box = document.createElement('div'); box.className = 'artist-detail'; if (!detail) { box.textContent = 'Loading releases…'; return box; }
  box.append(relatedEditor()); const releases = document.createElement('div'); releases.className = 'release-list';
  for (const release of detail.releases) {
    const entry = document.createElement('section'); entry.className = 'release'; const button = document.createElement('button'); button.className = `release-row${activeRelease === release.key ? ' expanded' : ''}`;
    button.innerHTML = `<span class="release-caret">›</span><span>${esc(release.title)}</span><span>${release.tracks.length} track${release.tracks.length === 1 ? '' : 's'}${release.compilation ? ' · Compilation' : ''}</span>`;
    button.onclick = () => { activeRelease = activeRelease === release.key ? '' : release.key; editingTrack = ''; expandedDetailHeight = 0; render(currentScroll()); };
    entry.append(button); if (activeRelease === release.key) { const tracks = document.createElement('div'); tracks.className = 'track-list'; release.tracks.forEach(track => tracks.append(trackRow(track))); entry.append(tracks); } releases.append(entry);
  }
  box.append(releases); return box;
}
function render(scrollTop = currentScroll()) {
  content.replaceChildren(); const nextViewport = document.createElement('div'); nextViewport.className = 'artist-viewport'; const expandedIndex = artists.findIndex(artist => artist.key === activeArtist); const detailHeight = expandedHeight();
  const stage = document.createElement('div'); stage.className = 'artist-stage'; stage.style.height = `${artists.length * ROW_HEIGHT + (expandedIndex >= 0 ? detailHeight : 0)}px`; nextViewport.append(stage); content.append(nextViewport); viewport = nextViewport;
  const draw = () => {
    stage.replaceChildren(); const top = nextViewport.scrollTop, bottom = top + nextViewport.clientHeight; let offset = 0;
    artists.forEach((artist, index) => {
      const expanded = index === expandedIndex, height = ROW_HEIGHT + (expanded ? detailHeight : 0);
      if (offset + height >= top - 120 && offset <= bottom + 120) {
        const row = document.createElement('article'); row.className = `artist-row${expanded ? ' open' : ''}`; row.style.top = `${offset}px`; row.style.height = expanded ? 'auto' : `${height}px`;
        const button = document.createElement('button'); button.className = 'artist-summary'; button.innerHTML = `<span>${esc(artist.artist)}</span><span>${artist.itemCount.toLocaleString()}</span><span>${artist.ratedPercent}%</span>`; button.onclick = () => void openArtist(artist.key); row.append(button);
        if (expanded) row.append(artistDetail()); stage.append(row);
        if (expanded && detail) requestAnimationFrame(() => { const measured = Math.ceil(row.getBoundingClientRect().height - ROW_HEIGHT); if (measured > 0 && measured !== expandedDetailHeight) { expandedDetailHeight = measured; render(nextViewport.scrollTop); } });
      }
      offset += height;
    });
  };
  nextViewport.onscroll = draw; nextViewport.scrollTop = Math.min(scrollTop, Math.max(0, Number.parseInt(stage.style.height, 10) - nextViewport.clientHeight)); draw();
}
search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { query = search.value.trim(); void loadArtists(); }, 120); };
loadArtists().catch(error => { summary.textContent = error.message; });
