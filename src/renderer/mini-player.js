const track = document.getElementById('track');
const trackTitle = document.getElementById('trackTitle');
const trackDetail = document.getElementById('trackDetail');
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

function isActiveMusic(status = currentStatus) {
  return Boolean(status?.currentMusic && status?.mediaState !== 'stopped');
}

function setTrack(title, detail) {
  trackTitle.textContent = title || 'WaveDeck';
  trackDetail.textContent = detail || 'Ready';
  track.title = [title, detail].filter(Boolean).join(' — ') || 'WaveDeck';
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
    setTrack(title, detail);
  } else if (status?.currentRecording && status?.mediaState !== 'stopped') {
    setTrack(status.currentRecording.name || 'WaveDeck Recording', status.mediaState === 'paused' ? 'Paused' : 'Playing');
  } else if (status?.currentStation && status?.mediaState !== 'stopped') {
    const detail = status.state === 'connecting'
      ? 'Connecting…'
      : (status.mediaState === 'paused' ? 'Paused' : (streamMetadata || status.message || 'Playing'));
    setTrack(status.currentStation.name || 'Streaming Radio', detail);
  } else if (status?.state === 'error') {
    setTrack('WaveDeck', status.message || 'Playback error');
  } else {
    setTrack('WaveDeck', status?.mediaState === 'paused' ? 'Paused' : 'Stopped');
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
    setTrack('WaveDeck', error.message || 'That action could not be completed.');
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
    setTrack('WaveDeck', error.message || 'Could not save thumbs-up feedback.');
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

(async function initialize() {
  try {
    currentStatus = await window.wavedeck.getPlayerStatus();
  } catch (error) {
    currentStatus = { state: 'error', message: error.message, mediaState: 'stopped' };
  }
  render();
})();
