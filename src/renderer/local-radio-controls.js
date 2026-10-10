const crossfade = document.getElementById('localMusicCrossfade');
const localMixFavorLastFm = document.getElementById('localMixFavorLastFm');
const familiarity = document.getElementById('localRadioFamiliarity');
const exploreDistance = document.getElementById('localRadioExploreDistance');
const songRepeat = document.getElementById('localRadioSongRepeat');
const songRepeatValue = document.getElementById('localRadioSongRepeatValue');
const artistRepeat = document.getElementById('localRadioArtistRepeat');
const artistSet = document.getElementById('localRadioArtistSet');
const status = document.getElementById('status');

const FAMILIARITY = ['deep-cuts', 'balanced', 'hits'];
const EXPLORE_DISTANCES = ['close', 'detour', 'explore'];
const ARTIST_WAITS = [30, 60, 90, 120, 180];
const ARTIST_SETS = [1, 2, 3, 4];

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

function render(preferences = {}) {
  crossfade.checked = preferences.localMusicCrossfadeEnabled !== false;
  localMixFavorLastFm.checked = preferences.localMixFavorLastFm === true;
  const selectedExploreDistance = EXPLORE_DISTANCES.includes(preferences.localRadioExploreDistance) ? preferences.localRadioExploreDistance : 'detour';
  exploreDistance.value = String(EXPLORE_DISTANCES.indexOf(selectedExploreDistance));
  const selectedFamiliarity = FAMILIARITY.includes(preferences.localRadioFamiliarity) ? preferences.localRadioFamiliarity : 'balanced';
  familiarity.value = String(FAMILIARITY.indexOf(selectedFamiliarity));
  const songHours = Number.isInteger(Number(preferences.localRadioSongRepeatHours)) ? Number(preferences.localRadioSongRepeatHours) : 4;
  const artistMinutes = ARTIST_WAITS.includes(Number(preferences.localRadioArtistRepeatMinutes)) ? Number(preferences.localRadioArtistRepeatMinutes) : 90;
  const setSize = ARTIST_SETS.includes(Number(preferences.localRadioArtistSetSize)) ? Number(preferences.localRadioArtistSetSize) : 1;
  songRepeat.value = String(songHours);
  artistRepeat.value = String(ARTIST_WAITS.indexOf(artistMinutes));
  artistSet.value = String(ARTIST_SETS.indexOf(setSize));
  updateSongRepeatStop(songHours);
}

crossfade.addEventListener('change', async () => {
  crossfade.disabled = true;
  try {
    render(await window.wavedeck.setLocalMusicCrossfade(crossfade.checked));
    showStatus();
  } catch (error) {
    crossfade.checked = !crossfade.checked;
    showStatus(`Could not save crossfade: ${error.message}`, true);
  } finally { crossfade.disabled = false; }
});

localMixFavorLastFm.addEventListener('change', async () => {
  localMixFavorLastFm.disabled = true;
  try {
    render(await window.wavedeck.setLocalMixFavorLastFm(localMixFavorLastFm.checked));
    showStatus();
  } catch (error) {
    localMixFavorLastFm.checked = !localMixFavorLastFm.checked;
    showStatus(`Could not save Local Mix preference: ${error.message}`, true);
  } finally { localMixFavorLastFm.disabled = false; }
});

familiarity.addEventListener('change', async () => {
  familiarity.disabled = true;
  try {
    const value = FAMILIARITY[Number(familiarity.value)] || 'balanced';
    render(await window.wavedeck.setLocalRadioFamiliarity(value));
    showStatus();
  } catch (error) { showStatus(`Could not save Song familiarity: ${error.message}`, true); }
  finally { familiarity.disabled = false; }
});

exploreDistance.addEventListener('change', async () => {
  exploreDistance.disabled = true;
  try {
    render(await window.wavedeck.setLocalRadioExploreDistance(EXPLORE_DISTANCES[Number(exploreDistance.value)] || 'detour'));
    showStatus();
  } catch (error) { showStatus(`Could not save Explore Radio setting: ${error.message}`, true); }
  finally { exploreDistance.disabled = false; }
});

songRepeat.addEventListener('input', () => updateSongRepeatStop(songRepeat.value));
for (const control of [songRepeat, artistRepeat, artistSet]) {
  control.addEventListener('change', async () => {
    const controls = [songRepeat, artistRepeat, artistSet];
    controls.forEach(item => { item.disabled = true; });
    try {
      render(await window.wavedeck.setLocalRadioTuning(currentTuning()));
      showStatus();
    } catch (error) { showStatus(`Could not save Local Radio rotation settings: ${error.message}`, true); }
    finally { controls.forEach(item => { item.disabled = false; }); }
  });
}

window.wavedeck.onUiPreferencesChanged(render);
window.wavedeck.getUiPreferences().then(render).catch(error => showStatus(error.message, true));
