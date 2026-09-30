const crossfade = document.getElementById('localMusicCrossfade');
const familiarity = document.getElementById('localRadioFamiliarity');
const familiarityHelp = document.getElementById('localRadioFamiliarityHelp');
const songRepeat = document.getElementById('localRadioSongRepeat');
const songRepeatHelp = document.getElementById('localRadioSongRepeatHelp');
const songRepeatValue = document.getElementById('localRadioSongRepeatValue');
const artistRepeat = document.getElementById('localRadioArtistRepeat');
const artistRepeatHelp = document.getElementById('localRadioArtistRepeatHelp');
const artistSet = document.getElementById('localRadioArtistSet');
const artistSetHelp = document.getElementById('localRadioArtistSetHelp');
const status = document.getElementById('status');

const FAMILIARITY = ['deep-cuts', 'balanced', 'hits'];
const ARTIST_WAITS = [30, 60, 90, 120, 180];
const ARTIST_SETS = [1, 2, 3, 4];
const SET_LABELS = ['Single Tracks', 'Two-fers', 'Three-way', 'Four-play'];
const FAMILIARITY_COPY = {
  hits: 'Favor the Hits — chooses first from Favorites and 7–10 ratings, with the strongest odds for 9–10. Last.fm is the fallback.',
  balanced: 'Balanced Mix — chooses first from Favorites and 5–10 ratings, while giving every qualifying rating a useful chance. This is the default.',
  'deep-cuts': 'Play Deep Cuts Too — chooses first from Favorites and 3–10 ratings. Hits stay in rotation while 3–6 get more opportunity.'
};

function showStatus(message = '', isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function currentTuning() {
  return {
    songRepeatHours: Number(songRepeat.value) || 4,
    artistRepeatMinutes: ARTIST_WAITS[Number(artistRepeat.value)] || 90,
    artistSetSize: ARTIST_SETS[Number(artistSet.value)] || 1
  };
}

function updateSongRepeatStop(hours) {
  const value = Math.min(24, Math.max(1, Number(hours) || 4));
  songRepeatValue.hidden = value === 1 || value === 24;
  songRepeatValue.textContent = `${value} hours`;
  songRepeatValue.style.setProperty('--repeat-stop', `${((value - 1) / 23) * 100}%`);
}

function updateTuningHelp() {
  const value = currentTuning();
  songRepeatHelp.textContent = `${value.songRepeatHours} hours. A song cannot return until this wait has passed.`;
  updateSongRepeatStop(value.songRepeatHours);
  artistRepeatHelp.textContent = `${value.artistRepeatMinutes} minutes. The artist cannot return until this wait has passed.`;
  artistSetHelp.textContent = value.artistSetSize === 1
    ? 'Single Tracks is the default. An artist rests after each song.'
    : `${SET_LABELS[value.artistSetSize - 1]} plays before the artist's repeat wait begins.`;
}

function render(preferences = {}) {
  crossfade.checked = preferences.localMusicCrossfadeEnabled !== false;
  const selectedFamiliarity = FAMILIARITY.includes(preferences.localRadioFamiliarity) ? preferences.localRadioFamiliarity : 'balanced';
  familiarity.value = String(FAMILIARITY.indexOf(selectedFamiliarity));
  familiarityHelp.textContent = FAMILIARITY_COPY[selectedFamiliarity];
  const songHours = Number.isInteger(Number(preferences.localRadioSongRepeatHours)) ? Number(preferences.localRadioSongRepeatHours) : 4;
  const artistMinutes = ARTIST_WAITS.includes(Number(preferences.localRadioArtistRepeatMinutes)) ? Number(preferences.localRadioArtistRepeatMinutes) : 90;
  const setSize = ARTIST_SETS.includes(Number(preferences.localRadioArtistSetSize)) ? Number(preferences.localRadioArtistSetSize) : 1;
  songRepeat.value = String(songHours);
  artistRepeat.value = String(ARTIST_WAITS.indexOf(artistMinutes));
  artistSet.value = String(ARTIST_SETS.indexOf(setSize));
  updateTuningHelp();
}

crossfade.addEventListener('change', async () => {
  crossfade.disabled = true;
  try {
    render(await window.wavedeck.setLocalMusicCrossfade(crossfade.checked));
    showStatus(crossfade.checked ? 'Crossfade is on.' : 'Crossfade is off.');
  } catch (error) {
    crossfade.checked = !crossfade.checked;
    showStatus(`Could not save crossfade: ${error.message}`, true);
  } finally { crossfade.disabled = false; }
});

familiarity.addEventListener('input', () => {
  familiarityHelp.textContent = FAMILIARITY_COPY[FAMILIARITY[Number(familiarity.value)] || 'balanced'];
});
familiarity.addEventListener('change', async () => {
  familiarity.disabled = true;
  try {
    const value = FAMILIARITY[Number(familiarity.value)] || 'balanced';
    render(await window.wavedeck.setLocalRadioFamiliarity(value));
    showStatus('Song familiarity saved.');
  } catch (error) { showStatus(`Could not save Song familiarity: ${error.message}`, true); }
  finally { familiarity.disabled = false; }
});

for (const control of [songRepeat, artistRepeat, artistSet]) {
  control.addEventListener('input', updateTuningHelp);
  control.addEventListener('change', async () => {
    const controls = [songRepeat, artistRepeat, artistSet];
    controls.forEach(item => { item.disabled = true; });
    try {
      render(await window.wavedeck.setLocalRadioTuning(currentTuning()));
      showStatus('Local Radio rotation settings saved.');
    } catch (error) { showStatus(`Could not save Local Radio rotation settings: ${error.message}`, true); }
    finally { controls.forEach(item => { item.disabled = false; }); }
  });
}

window.wavedeck.onUiPreferencesChanged(render);
window.wavedeck.getUiPreferences().then(render).catch(error => showStatus(error.message, true));
