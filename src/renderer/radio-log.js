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
  addBox(grid, 'Local Radio policy', [
    `Song familiarity: ${({ hits: 'Favor the Hits', balanced: 'Balanced Mix', 'deep-cuts': 'Play Deep Cuts Too' })[decision.familiarity] || 'Balanced Mix'}`,
    'Strong musical links are required',
    'Poor-fit candidates wait instead of playing'
  ]);
  addBox(grid, 'Last.fm popularity', [
    selected.popularity === null || selected.popularity === undefined ? 'Missing — treated as neutral' : `${selected.popularity}/100`,
    'Adjusted by the Song familiarity preference',
    'Similar artists can provide a meaningful link'
  ]);
  addBox(grid, 'Selection safeguards', [
    'Same album, artist, credits, Last.fm, or a specific tag',
    'Broad tags such as Rock or Country do not qualify alone',
    'MP3 ratings are read-only and gently influence a credible pick',
    'Exact-song repeat wait: 2 hours'
  ]);
  addBox(grid, 'Candidates', [
    `${decision.counts?.totalTracks ?? 0} total · ${decision.counts?.credible ?? 0} credible`,
    `${decision.counts?.finalPool ?? 0} in the final pool`,
    `Skipped: ${decision.counts?.skippedForCooldown ?? 0} repeat wait, ${decision.counts?.skippedForHandoff ?? 0} repeated handoff`
  ]);
  body.append(grid);
  const additions = (selected.additions || []).map(item => `${item.label}: +${number(item.amount)}`);
  addDetails(body, 'Why this song fit', [
    ...(selected.eligibilityReasons || []).map(reason => `Acceptable match: ${reason}`),
    ...additions
  ], 'It qualified for the acceptable pool through artist or similarity data.');
  const multipliers = (selected.multipliers || []).map(item => `${item.label}: ×${number(item.value, 3)}${item.source ? ` (${item.source})` : ''}`);
  multipliers.push(`Final score: ${number(selected.score, 3)}`);
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
