const entries = document.getElementById('entries');
const empty = document.getElementById('empty');
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

function varietyLabel(value) {
  return ({ 0: 'Off', 1: 'Light', 2: 'Balanced', 3: 'Strong', 4: 'Maximum' })[Number(value)] || 'Balanced';
}

function yearRangeLabel(value) {
  return ({ 0: 'Same year', 5: 'Within 5 years', 10: 'Within 10 years', 20: 'Within 20 years', 10000: 'Year doesn’t matter' })[Number(value)] || 'Within 10 years';
}

function renderDecision(decision, { prepend = true } = {}) {
  if (!decision?.selected) return;
  empty.hidden = true;
  const selected = decision.selected;
  const entry = element('article', '', 'entry');
  const head = element('div', '', 'entry-head');
  const mode = decision.mode === 'artist' ? 'Artist Radio' : 'Song Radio';
  head.append(element('b', mode));
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
  addBox(grid, 'Artist Focus', [
    `${decision.artistFocus?.targetPercent ?? 0}% target`,
    decision.artistFocus?.outcome || 'No outcome recorded',
    decision.artistFocus?.roll === null || decision.artistFocus?.roll === undefined ? 'No random focus roll needed' : `Focus roll: ${number(decision.artistFocus.roll, 3)}`
  ]);
  addBox(grid, 'Last.fm popularity', [
    selected.popularity === null || selected.popularity === undefined ? 'Missing — treated as neutral' : `${selected.popularity}/100`,
    `Song Popularity setting: ${decision.settings?.songPopularityPercent ?? 0}%`,
    selected.popularitySource === 'lastfm' ? 'Fresh Last.fm data' : 'Existing tag data'
  ]);
  addBox(grid, 'Radio controls', [
    `Artist Variety: ${varietyLabel(decision.settings?.artistVariety)}`,
    `Album Variety: ${varietyLabel(decision.settings?.albumVariety)}`,
    `${yearRangeLabel(decision.settings?.releaseYearRange)} · ${Number(decision.settings?.repeatCooldownMinutes || 0) / 60} hour repeat wait`,
    `Ratings Matter: ${['Off', 'Gentle', 'Moderate', 'Strong', 'Dominant'][Number(decision.settings?.ratingInfluence) || 0]}`
  ]);
  addBox(grid, 'Candidates', [
    `${decision.counts?.totalTracks ?? 0} total · ${decision.counts?.eligible ?? 0} eligible`,
    `${decision.counts?.related ?? 0} acceptable · ${decision.counts?.excludedForRelevance ?? 0} excluded for poor fit · ${decision.counts?.finalPool ?? 0} in final pool`,
    `Skipped: ${decision.counts?.skippedForCooldown ?? 0} repeat wait, ${decision.counts?.skippedForHandoff ?? 0} repeated handoff`
  ]);
  body.append(grid);
  const additions = (selected.additions || []).map(item => `${item.label}: +${number(item.amount)}`);
  addDetails(body, 'Why this song fit', [
    ...(selected.eligibilityReasons || []).map(reason => `Acceptable match: ${reason}`),
    ...additions
  ], 'It qualified for the acceptable pool through artist or similarity data.');
  const multipliers = (selected.multipliers || []).map(item => `${item.label}: ×${number(item.value, 3)}${item.source ? ` (${item.source})` : ''}`);
  multipliers.push(`Score: ${number(selected.scoreBeforeRandomness, 3)} → ${number(selected.scoreAfterRandomness, 3)} after surprise/match setting`);
  addDetails(body, 'Score adjustments', multipliers, 'No score adjustments recorded.');
  body.append(element('div', `${decision.reason || 'A track was selected.'} Trigger: ${decision.selectionTrigger || 'next'}.`, 'reason'));
  entry.append(body);
  if (prepend) entries.prepend(entry); else entries.append(entry);
  while (entries.children.length > MAX_ENTRIES) entries.lastElementChild.remove();
}

clearLog.addEventListener('click', () => {
  entries.replaceChildren();
  empty.hidden = false;
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
window.wavedeck.getMusicDebugLog().then((decision) => renderDecision(decision, { prepend: false })).catch(() => {});
