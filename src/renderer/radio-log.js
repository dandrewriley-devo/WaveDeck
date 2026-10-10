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
  if (artistSet?.size > 1) {
    lines.push(`We’re playing another ${selected.artist || 'artist'} song. This is track ${artistSet.position} of ${artistSet.size} in the artist set.${artistSet.shortened ? ` WaveDeck shortened the requested ${artistSet.requested}-track set so the station could keep playing.` : ''}`);
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
  if (song.popularity !== null && song.popularity !== undefined) factors.push(`Last.fm popularity of ${song.popularity}/100`);
  if (song.rating) factors.push(`your ${song.rating}/10 rating`);
  if (song.favorite) factors.push('your Favorite tag');
  if (song.thumbsUp) factors.push(`${song.thumbsUp} thumbs-up${song.thumbsUp === 1 ? '' : 's'} for this station`);
  if (song.thumbsDown) factors.push(`${song.thumbsDown} negative feedback mark${song.thumbsDown === 1 ? '' : 's'} for this station`);
  if (song.skips) factors.push(`${song.skips} earlier skip${song.skips === 1 ? '' : 's'} for this station`);
  lines.push(`WaveDeck picked ${quoted(selected.title)} from that pool based on ${naturalList(factors, 99) || 'its relationship to the station and the current variety protections'}.`);
  return lines;
}

function renderDecision(decision, { prepend = true } = {}) {
  if (!decision) return;
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
  const grid = element('div', '', 'grid');
  addBox(grid, 'Station seed', [
    `${decision.seed?.title || 'Unknown song'} — ${decision.seed?.artist || 'Unknown artist'}`,
    decision.seed?.album || 'No album'
  ]);
  addBox(grid, manualStart ? 'Start type' : 'Local Radio policy', manualStart ? [
    'You selected this opening track',
    'The next track will be chosen automatically'
  ] : [
    `Song familiarity: ${({ hits: 'Favor the Hits', balanced: 'Balanced Mix', 'deep-cuts': 'Play Deep Cuts Too' })[decision.familiarity] || 'Balanced Mix'}`,
    'Strong musical links are required',
    'Poor-fit candidates never play; recovery stays within related artists'
  ]);
  addBox(grid, 'Last.fm popularity', [
    selected.popularity === null || selected.popularity === undefined ? 'Missing — treated as neutral' : `${selected.popularity}/100`,
    'Adjusted by the Song familiarity preference',
    'Similar artists can provide a meaningful link'
  ]);
  addBox(grid, 'Selection safeguards', [
    'Same album, artist, credits, Last.fm, or a specific tag',
    'Broad tags such as Rock or Country do not qualify alone',
    'DO_NOT_PLAY is an absolute exclusion',
    'Favorite tags and MP3 ratings lead personal song choice',
    'Repeat waits bend only after the related-artist safety net is exhausted'
  ]);
  addBox(grid, 'Candidates', manualStart ? [
    'No candidate search was needed',
    'This track was selected directly'
  ] : [
    `${decision.counts?.totalTracks ?? 0} total · ${decision.counts?.credible ?? 0} credible`,
    `${decision.counts?.personal ?? 0} personal ${decision.counts?.personalMinimum ?? '—'}–10/Favorite · ${decision.counts?.lastFmFamiliar ?? 0} Last.fm familiar`,
    `${decision.counts?.finalPool ?? 0} in the final pool`,
    `Skipped: ${decision.counts?.skippedForCooldown ?? 0} repeat wait, ${decision.counts?.skippedForDoNotPlay ?? 0} Do Not Play`
  ]);
  body.append(grid);
  addDetails(body, 'How it was picked', howPickedLines(decision, selected, manualStart), 'WaveDeck did not save a plain-language selection story for this entry.');
  const additions = (selected.additions || []).map(item => `${item.label}: +${number(item.amount)}`);
  addDetails(body, waiting ? 'Why no song was available' : 'Why this song fit', [
    ...(selected.eligibilityReasons || []).map(reason => `Acceptable match: ${reason}`),
    ...additions
  ], 'It qualified for the acceptable pool through artist or similarity data.');
  const multipliers = (selected.multipliers || []).map(item => `${item.label}: ×${number(item.value, 3)}${item.source ? ` (${item.source})` : ''}`);
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
    await window.wavedeck.clearMusicDebugHistory();
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
    const result = await window.wavedeck.saveMusicDebugLog();
    if (result?.canceled) {
      saveStatus.textContent = 'Save cancelled.';
    } else {
      saveStatus.textContent = `Saved ${result?.count || 0} radio selections for diagnosis.`;
    }
  } catch (error) {
    saveStatus.textContent = `Could not save the diagnostic log: ${error?.message || 'Unknown error'}`;
  } finally {
    saveLog.disabled = false;
  }
});

window.wavedeck.onMusicDebugLog((decision) => renderDecision(decision));
window.wavedeck.getMusicDebugHistory().then((decisions) => {
  for (const decision of (Array.isArray(decisions) ? decisions : []).slice().reverse()) renderDecision(decision, { prepend: false });
}).catch(() => {});
window.wavedeck.onMusicDebugReset(() => {
  entries.replaceChildren();
});
