const track = document.getElementById('track');
const trackText = document.getElementById('trackText');
const previousBtn = document.getElementById('previousBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const playPauseIcon = document.getElementById('playPauseIcon');
const stopBtn = document.getElementById('stopBtn');
const nextBtn = document.getElementById('nextBtn');
const thumbUpBtn = document.getElementById('thumbUpBtn');

let currentStatus = null;
let streamMetadata = '';
let feedbackTrackId = '';
let feedbackSelected = false;
let displayMode = 'now-playing';
let trackPointer = null;

function isActiveMusic(status = currentStatus) {
  return Boolean(status?.currentMusic && status?.mediaState !== 'stopped');
}

function setTrack(text, tooltip = text) {
  trackText.textContent = text || 'WaveDeck';
  const detail = tooltip || text || 'WaveDeck';
  track.title = `Click to switch display • Drag to move\n${detail}`;
  track.setAttribute('aria-label', `${detail}. Click to switch display; drag to move.`);
}

async function toggleDisplay() {
  try {
    const preferences = await window.wavedeck.toggleMiniPlayerDisplay();
    displayMode = preferences?.miniPlayerDisplayMode === 'source' ? 'source' : 'now-playing';
    render();
  } catch (error) {
    setTrack(error.message || 'Could not switch display.');
  }
}

track.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  trackPointer = { id: event.pointerId, startX: event.screenX, moved: false };
  track.setPointerCapture(event.pointerId);
  window.wavedeck.startMiniPlayerDrag(event.screenX);
});
track.addEventListener('pointermove', event => {
  if (!trackPointer || event.pointerId !== trackPointer.id) return;
  if (Math.abs(event.screenX - trackPointer.startX) >= 4) trackPointer.moved = true;
  if (trackPointer.moved) window.wavedeck.moveMiniPlayerDrag(event.screenX);
});
function finishTrackPointer(event) {
  if (!trackPointer || event.pointerId !== trackPointer.id) return;
  const moved = trackPointer.moved;
  if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  trackPointer = null;
  window.wavedeck.endMiniPlayerDrag();
  if (!moved && event.type === 'pointerup') void toggleDisplay();
}
track.addEventListener('pointerup', finishTrackPointer);
track.addEventListener('pointercancel', finishTrackPointer);
track.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  void toggleDisplay();
});

function joinNowPlaying(title, detail) {
  return [title, detail].filter(Boolean).join(' — ') || 'WaveDeck';
}

function render(status = currentStatus) {
  const playing = status?.mediaState === 'playing';
  playPauseIcon.innerHTML = playing
    ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'
    : '<path d="m8 5 11 7-11 7z" fill="currentColor"/>';
  playPauseBtn.title = playing ? 'Pause' : 'Play';
  playPauseBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');

  const music = status?.currentMusic;
  const musicActive = isActiveMusic(status);
  if (musicActive) {
    const song = music.track || {};
    const title = song.title || music.label || 'Local Music';
    const detail = music.waiting
      ? 'Waiting for a song that fits this radio seed.'
      : (status?.mediaState === 'paused' ? 'Paused' : (song.artist || 'Local Music'));
    const nowPlaying = joinNowPlaying(title, detail);
    setTrack(displayMode === 'source' ? (music.label || 'Local Music') : nowPlaying, nowPlaying);
  } else if (status?.currentRecording && status?.mediaState !== 'stopped') {
    const nowPlaying = joinNowPlaying(status.currentRecording.name || 'WaveDeck Recording', status.mediaState === 'paused' ? 'Paused' : 'Playing');
    setTrack(nowPlaying);
  } else if (status?.currentStation && status?.mediaState !== 'stopped') {
    const detail = status.state === 'connecting'
      ? 'Connecting…'
      : (status.mediaState === 'paused' ? 'Paused' : (streamMetadata || status.message || 'Playing'));
    const station = status.currentStation.name || 'Streaming Radio';
    setTrack(displayMode === 'source' ? station : joinNowPlaying(station, detail), joinNowPlaying(station, detail));
  } else if (status?.state === 'error') {
    setTrack(status.message || 'Playback error', `WaveDeck — ${status.message || 'Playback error'}`);
  } else {
    setTrack(status?.mediaState === 'paused' ? 'Paused' : 'Stopped', `WaveDeck — ${status?.mediaState === 'paused' ? 'Paused' : 'Stopped'}`);
  }

  const eligibleFeedback = musicActive && ['artist', 'radio', 'mix'].includes(music.mode) && Boolean(music.track);
  const trackId = String(music?.track?.id || '');
  if (trackId !== feedbackTrackId) {
    feedbackTrackId = trackId;
    feedbackSelected = false;
  }
  thumbUpBtn.disabled = !eligibleFeedback;
  thumbUpBtn.classList.toggle('feedback-selected', eligibleFeedback && feedbackSelected);
  previousBtn.title = musicActive ? 'Previous song' : 'Previous Preset';
  nextBtn.title = musicActive ? 'Next song' : 'Next Preset';
  previousBtn.setAttribute('aria-label', previousBtn.title);
  nextBtn.setAttribute('aria-label', nextBtn.title);
}

async function run(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    setTrack(error.message || 'That action could not be completed.', `WaveDeck — ${error.message || 'That action could not be completed.'}`);
  } finally {
    button.disabled = false;
    setTimeout(() => render(), 100);
  }
}

previousBtn.addEventListener('click', () => { void run(previousBtn, () => window.wavedeck.previousPreset()); });
playPauseBtn.addEventListener('click', () => { void run(playPauseBtn, () => window.wavedeck.playPause()); });
stopBtn.addEventListener('click', () => { void run(stopBtn, () => window.wavedeck.stop()); });
nextBtn.addEventListener('click', () => { void run(nextBtn, () => window.wavedeck.nextPreset()); });
thumbUpBtn.addEventListener('click', async () => {
  thumbUpBtn.disabled = true;
  try {
    await window.wavedeck.sendMusicFeedback('up');
    feedbackSelected = true;
  } catch (error) {
    setTrack(error.message || 'Could not save thumbs-up feedback.', `WaveDeck — ${error.message || 'Could not save thumbs-up feedback.'}`);
  } finally {
    setTimeout(() => render(), 100);
  }
});

window.wavedeck.onMetadata((metadata) => {
  if (!isActiveMusic() && metadata) {
    streamMetadata = metadata;
    render();
  }
});
window.wavedeck.onStationChanged((station) => {
  streamMetadata = '';
  if (currentStatus) currentStatus = { ...currentStatus, currentStation: station || null };
  render();
});
window.wavedeck.onPlayerStatus((status) => {
  currentStatus = status;
  render(status);
});

window.wavedeck.onUiPreferencesChanged((preferences) => {
  const nextMode = preferences?.miniPlayerDisplayMode === 'source' ? 'source' : 'now-playing';
  if (displayMode !== nextMode) {
    displayMode = nextMode;
    render();
  }
});

(async function initialize() {
  try {
    const [status, preferences] = await Promise.all([
      window.wavedeck.getPlayerStatus(),
      window.wavedeck.getUiPreferences()
    ]);
    currentStatus = status;
    displayMode = preferences?.miniPlayerDisplayMode === 'source' ? 'source' : 'now-playing';
  } catch (error) {
    currentStatus = { state: 'error', message: error.message, mediaState: 'stopped' };
  }
  render();
})();
