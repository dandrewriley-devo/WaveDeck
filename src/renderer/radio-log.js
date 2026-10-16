const wavedeck = embeddedWavedeck;
const entries = document.getElementById('entries');
const clearLog = document.getElementById('clearLog');
const saveLog = document.getElementById('saveLog');
const saveStatus = document.getElementById('saveStatus');
const MAX_ENTRIES = 60;

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function number(value, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits).replace(/\.00$/, '') : '—';
}

function addBox(parent, title, lines) {
  const box = element('div', '', 'box');
  box.append(element('b', title));
  for (const line of lines) box.append(element('div', line, 'muted'));
  parent.append(box);
}

function addDetails(parent, title, items, fallback) {
  const section = element('section', '', 'details');
  section.append(element('div', title, 'section-title'));
  if (!items.length) section.append(element('div', fallback, 'muted'));
  for (const item of items) section.append(element('div', item));
  parent.append(section);
}

function quoted(value, fallback = 'Unknown song') { return `“${String(value || fallback)}”`; }

function naturalList(values = [], maximum = 12) {
  const unique = [...new Set(values.filter(Boolean))]; const visible = unique.slice(0, maximum); const more = unique.length - visible.length;
  if (!visible.length) return '';
  if (visible.length === 1) return `${visible[0]}${more ? ` and ${more} more` : ''}`;
  const text = visible.length === 2 ? `${visible[0]} and ${visible[1]}` : `${visible.slice(0, -1).join(', ')}, and ${visible.at(-1)}`;
  return more ? `${text}, and ${more} more` : text;
}

function howPickedLines(decision, selected, manualStart) {
  const info = decision.howPicked;
  if (manualStart || info?.manualStart) return [`You selected ${quoted(selected.title)} by ${selected.artist || 'Unknown artist'} to begin this station. The next track will be selected automatically.`];
  if (!decision.selected || info?.waiting) {
    const counts = decision.counts || {};
    return [
      'WaveDeck could not find a playable track after checking the station family and its repeat-protection recovery steps.',
      `${counts.credible ?? 0} credible tracks were available before repeat protection; ${counts.skippedForCooldown ?? 0} were resting by song and ${counts.skippedForArtistCooldown ?? 0} by artist.`
    ];
  }
  if (!info) return ['This older log entry has the score details below, but it was recorded before WaveDeck began saving the plain-language selection story.'];
  const seed = info.seed || decision.seed || {};
  const lines = [`This station began with ${quoted(seed.title)} by ${seed.artist || 'Unknown artist'}.`];
  const artistSet = info.artistSet;
  if (artistSet?.size > 1 && artistSet.position > 1) {
    lines.push(`We’re playing another ${selected.artist || 'artist'} song. This is track ${artistSet.position} of ${artistSet.size} in the artist set.${artistSet.shortened ? ` WaveDeck shortened the requested ${artistSet.requested}-track set so the station could keep playing.` : ''}`);
  }
  const skippedSetTracks = Array.isArray(artistSet?.skipped) ? artistSet.skipped.filter(item => item?.title) : [];
  for (const skipped of skippedSetTracks) lines.push(`WaveDeck skipped ${quoted(skipped.title)}${skipped.reason ? ` because it ${skipped.reason}` : ''}.`);
  const endedSet = info.artistSetRecovery;
  if (endedSet?.artist && Array.isArray(endedSet.skipped) && endedSet.skipped.length) {
    const skipped = endedSet.skipped[0];
    lines.push(`The planned ${endedSet.artist} set ended early because ${quoted(skipped.title)}${skipped.reason ? ` ${skipped.reason}` : ' was no longer available'}.`);
  }
  const related = naturalList(info.relatedArtists);
  if (!artistSet?.size || artistSet.size <= 1) {
    if (related) lines.push(`Related artists available in your library were ${related}.`);
    else lines.push('No Last.fm related artists from the active route were available in your library for this pick.');
  }
  const recovery = info.recovery;
  if (recovery?.kind === 'related-route') lines.push(`The closer station family was exhausted, so WaveDeck expanded through a ${recovery.hops}-hop related-artist route from the original seed.`);
  if (recovery?.relaxedRepeat === 'artist') lines.push('All normal options were exhausted, so WaveDeck eased artist rest within this station family to keep the station playing.');
  if (recovery?.relaxedRepeat === 'song') lines.push('All normal options were exhausted, so WaveDeck used the least-recently-played credible song within this station family.');
  const explore = info.explore;
  if (explore) {
    const distance = ({ close: 'Close to Home', detour: 'Take a Detour', explore: 'Go Exploring' })[explore.distance] || 'Take a Detour';
    const hopWord = explore.hops === 1 ? 'hop' : 'hops';
    lines.push(`Explore Radio is set to ${distance}. This pick is ${explore.hops} ${hopWord} from the original seed${explore.activeAnchor ? `, using ${explore.activeAnchor} as the active route` : ''}.`);
    if (explore.rescueUsed) lines.push('The current route had no eligible next track, so WaveDeck found another nearby related-artist route from the original seed.');
    else if (explore.returningToSeed) lines.push('WaveDeck is pulling this route back toward the original seed.');
  }
  const artist = info.artist || {}; const chosenArtist = artist.name || selected.artist || 'Unknown artist';
  lines.push(`WaveDeck chose ${chosenArtist} because ${artist.reason || 'it was in the eligible pool for this station'}.`);
  const resting = naturalList(info.restingRelatedArtists);
  if (resting) lines.push(`Other related artists were played more recently and were resting: ${resting}.`);
  if (artist.eligibleTracks > 0) lines.push(`${chosenArtist} had ${artist.eligibleTracks} eligible ${artist.eligibleTracks === 1 ? 'track' : 'tracks'} based on repeat-protection settings.`);
  const song = info.song || {}; const factors = [];
  if (song.secondarySeed?.title || song.secondarySeed?.artist) lines.push(`Your thumbs-up on ${quoted(song.secondarySeed.title, 'a liked song')} made it a secondary seed. ${chosenArtist} was considered because it has a credible relationship to that song.`);
  if (song.popularity !== null && song.popularity !== undefined) factors.push(`Last.fm popularity of ${song.popularity}/100`);
  if (song.rating) factors.push(`your ${song.rating}/10 rating`);
  if (song.favorite) factors.push('your Favorite tag');
  if (song.thumbsUp) factors.push(`${song.thumbsUp} thumbs-up${song.thumbsUp === 1 ? '' : 's'} for this station`);
  if (song.thumbsDown) factors.push(`${song.thumbsDown} negative feedback mark${song.thumbsDown === 1 ? '' : 's'} for this station`);
  if (song.skips) factors.push(`${song.skips} earlier skip${song.skips === 1 ? '' : 's'} for this station`);
  lines.push(`WaveDeck picked ${quoted(selected.title)} from that pool based on ${naturalList(factors, 99) || 'its relationship to the station and the current variety protections'}.`);
  if (song.thumbsUp) lines.push(`Your ${song.thumbsUp} thumbs-up${song.thumbsUp === 1 ? '' : 's'} gave this track a ${Math.round(song.thumbsUp * 18)}% selection boost.`);
  return lines;
}

function familiarityLabel(value) {
  return ({ hits: 'Favor the Hits', balanced: 'Balanced Mix', 'deep-cuts': 'Play Deep Cuts Too' })[value] || 'Balanced Mix';
}

function artistSetLabel(size) {
  return `${size}-song set${size === 1 ? '' : 's'}`;
}

function songFamiliarityLines(decision, selected) {
  const popularity = Number(selected.popularity);
  const multiplier = (selected.multipliers || []).find(item => item.label === 'Song familiarity');
  if (!Number.isFinite(popularity) || !multiplier) {
    return ['No Last.fm popularity available', 'Song Familiarity left this choice neutral.'];
  }
  const delta = Math.round(Math.abs((Number(multiplier.value) - 1) * 100));
  const label = familiarityLabel(decision.familiarity);
  const detail = Number(multiplier.value) >= 1
    ? `${label} gave this song a ${delta}% boost.`
    : `${label} reduced this song’s chance by ${delta}%.`;
  return [`Last.fm popularity: ${Math.round(popularity)}/100`, detail];
}

function radioControlLines(decision) {
  const tuning = decision.tuning || {};
  const hours = Number(tuning.songRepeatHours) || 4;
  const minutes = Number(tuning.artistRepeatMinutes) || 90;
  const setSize = Number(tuning.artistSetSize) || 1;
  return [
    `Song familiarity: ${familiarityLabel(decision.familiarity)}`,
    `Song repeat wait: ${hours} ${hours === 1 ? 'hour' : 'hours'}`,
    `Artist repeat wait: ${minutes} minutes`,
    `Artist sets: ${setSize === 1 ? 'Single Tracks' : artistSetLabel(setSize)}`,
    'Credible links only; recovery stays within related artists'
  ];
}

function rejectedTrackLines(decision, manualStart) {
  if (manualStart) return ['No automatic candidate search was needed.'];
  const counts = decision.counts || {};
  const lines = [
    ['Tagged “Do Not Play”', counts.skippedForDoNotPlay],
    ['Non-music genres (Comedy, Stand-up Comedy, Spoken Word)', counts.skippedForNonMusicGenre],
    ['Artist played too recently', counts.skippedForArtistCooldown],
    ['Song played too recently', counts.skippedForCooldown],
    ['Previously failed to play', counts.skippedByPlaybackError],
    ['No meaningful connection', counts.noMeaningfulConnection],
    ['No Last.fm data', counts.missingLastFmData]
  ].filter(([, value]) => Number(value) > 0).map(([label, value]) => `${label}: ${value}`);
  return lines.length ? lines : ['No tracks were rejected for this selection.'];
}

function artistSetLines(info) {
  const set = info?.artistSet;
  const proposed = Array.isArray(set?.proposed) ? set.proposed.filter(item => item?.title) : [];
  if (!set || set.size <= 1 || set.position !== 1 || proposed.length !== set.size) return null;
  const artist = proposed[0]?.artist || 'artist';
  return [`${artistSetLabel(set.size)}`, `Proposed ${artist} set:`, ...proposed.map((item, index) => `${index === 0 ? 'This track' : index === 1 ? 'Next' : 'Then'}: ${quoted(item.title)}`)];
}

function scoreAdjustmentLine(item) {
  if (item.label === 'Station feedback') {
    const delta = Math.round((Number(item.value) - 1) * 100);
    if (item.source?.includes('thumbs-up') && delta > 0) return `Thumbs-up feedback: +${delta}%${item.source ? ` (${item.source})` : ''}`;
  }
  return `${item.label}: ×${number(item.value, 3)}${item.source ? ` (${item.source})` : ''}`;
}

function renderStationId(decision, { prepend = true } = {}) {
  const entry = element('article', '', 'entry');
  const head = element('div', '', 'entry-head');
  head.append(element('b', 'Station ID'));
  head.append(element('span', new Date(decision.at).toLocaleString(), 'time'));
  entry.append(head);
  const body = element('div', '', 'entry-body');
  const track = element('div', '', 'track');
  track.append(element('b', decision.pool || 'Station ID'));
  track.append(element('span', ` — ${decision.fileName || 'Unnamed clip'}`));
  body.append(track);
  body.append(element('div', `${decision.pool || 'Station ID'} clip played at the next Local Music song boundary.`, 'reason'));
  entry.append(body);
  if (prepend) entries.prepend(entry); else entries.append(entry);
  while (entries.children.length > MAX_ENTRIES) entries.lastElementChild.remove();
}

function genreLine(selected) {
  if (!Array.isArray(selected?.genres)) return 'Genres: not recorded by this older log entry';
  return `Genres: ${naturalList(selected.genres) || 'No genre tags stored'}`;
}

function renderDecision(decision, { prepend = true } = {}) {
  if (!decision) return;
  if (decision.type === 'station-id') return renderStationId(decision, { prepend });
  const waiting = !decision.selected;
  const selected = decision.selected || { title: 'No song selected', artist: '', album: '', popularity: null, eligibilityReasons: [], additions: [], multipliers: [], score: null };
  const manualStart = decision.selectionTrigger === 'start' && decision.policy === 'manual-local-radio-start-v1';
  const entry = element('article', '', 'entry');
  const head = element('div', '', 'entry-head');
  const mode = decision.mode === 'artist' ? 'Artist Radio' : decision.mode === 'explore' ? 'Explore Radio' : decision.mode === 'mix' ? 'Local Mix' : 'Song Radio';
  head.append(element('b', waiting ? `${mode} — No eligible track` : (manualStart ? `${mode} — Selected seed track` : mode)));
  head.append(element('span', new Date(decision.at).toLocaleString(), 'time'));
  entry.append(head);
  const body = element('div', '', 'entry-body');
  const track = element('div', '', 'track');
  track.append(element('b', selected.title || 'Untitled track'));
  track.append(element('span', ` — ${selected.artist || 'Unknown artist'}${selected.album ? ` · ${selected.album}` : ''}`));
  body.append(track);
  body.append(element('div', genreLine(selected), 'muted'));
  const grid = element('div', '', 'grid');
  addBox(grid, 'Station seed', [
    `Seed song: ${decision.seed?.title || 'Unknown song'}`,
    `Artist: ${decision.seed?.artist || 'Unknown artist'}`,
    `Album: ${decision.seed?.album || 'No album'}`
  ]);
  addBox(grid, manualStart ? 'Start type' : 'Local Radio Controls', manualStart ? [
    'You selected this opening track',
    'The next track will be chosen automatically'
  ] : radioControlLines(decision));
  addBox(grid, 'Song Familiarity', songFamiliarityLines(decision, selected));
  addBox(grid, 'Rejected Tracks', rejectedTrackLines(decision, manualStart));
  addBox(grid, 'Candidates', manualStart ? [
    'No candidate search was needed',
    'This track was selected directly'
  ] : [
    `${decision.counts?.totalTracks ?? 0} total · ${decision.counts?.credible ?? 0} credible`,
    `${decision.counts?.personal ?? 0} personal ${decision.counts?.personalMinimum ?? '—'}–10/Favorite · ${decision.counts?.lastFmFamiliar ?? 0} Last.fm familiar`,
    `${decision.counts?.finalPool ?? 0} in the final pool`
  ]);
  const artistSetCard = artistSetLines(decision.howPicked);
  if (artistSetCard) addBox(grid, 'Artist Sets', artistSetCard);
  body.append(grid);
  addDetails(body, 'How it was picked', howPickedLines(decision, selected, manualStart), 'WaveDeck did not save a plain-language selection story for this entry.');
  const additions = (selected.additions || []).map(item => `${item.label}: +${number(item.amount)}`);
  addDetails(body, waiting ? 'Why no song was available' : 'Why this song fit', [
    ...(selected.eligibilityReasons || []).map(reason => `Acceptable match: ${reason}`),
    ...additions
  ], 'It qualified for the acceptable pool through artist or similarity data.');
  const multipliers = (selected.multipliers || []).map(scoreAdjustmentLine);
  if (!manualStart && !waiting) multipliers.push(`Final score: ${number(selected.score, 3)}`);
  addDetails(body, manualStart ? 'Selection details' : 'Score adjustments', multipliers, manualStart ? 'This seed track was selected directly, so no automatic score was calculated.' : 'No score adjustments recorded.');
  body.append(element('div', `${decision.reason || 'A track was selected.'} Trigger: ${decision.selectionTrigger || 'next'}.`, 'reason'));
  entry.append(body);
  if (prepend) entries.prepend(entry); else entries.append(entry);
  while (entries.children.length > MAX_ENTRIES) entries.lastElementChild.remove();
}

clearLog.addEventListener('click', async () => {
  clearLog.disabled = true;
  saveStatus.textContent = '';
  try {
    await wavedeck.clearMusicDebugHistory();
    entries.replaceChildren();
    saveStatus.textContent = 'Diagnostic history cleared.';
  } catch (error) {
    saveStatus.textContent = `Could not clear the diagnostic history: ${error?.message || 'Unknown error'}`;
  } finally {
    clearLog.disabled = false;
  }
});

saveLog.addEventListener('click', async () => {
  saveStatus.textContent = '';
  saveLog.disabled = true;
  try {
    const result = await wavedeck.saveMusicDebugLog();
    if (result?.canceled) {
      saveStatus.textContent = 'Save cancelled.';
    } else {
      saveStatus.textContent = `Saved ${result?.count || 0} Radio Log entries for diagnosis.`;
    }
  } catch (error) {
    saveStatus.textContent = `Could not save the diagnostic log: ${error?.message || 'Unknown error'}`;
  } finally {
    saveLog.disabled = false;
  }
});

wavedeck.onMusicDebugLog((decision) => renderDecision(decision));
wavedeck.getMusicDebugHistory().then((decisions) => {
  for (const decision of (Array.isArray(decisions) ? decisions : []).slice().reverse()) renderDecision(decision, { prepend: false });
}).catch(() => {});
wavedeck.onMusicDebugReset(() => {
  entries.replaceChildren();
});
