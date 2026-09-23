# WaveDeck Project Handoff

This file is an internal continuity reference for future WaveDeck work. It records the important product decisions, implementation details, testing evidence, and pending work from the WaveDeck local-music/radio development thread.

## Current published state

- Repository: `dandrewriley-devo/WaveDeck`
- Branch: `main`
- Current published version: **0.7.9**
- Current published commit: `ea3859a77764ae0e40e8f91c1494f864d94663d4`
- Previous relevant commits:
  - `ce39d7f` — 0.7.8 single Settings scrollbar attempt
  - `fec55ae` — 0.7.7 Last.fm catch-up refresh skips tracks checked within seven days
  - `4077d36` — 0.7.6 first Settings scrolling fix attempt
  - `a824b1f` — 0.7.5 Last.fm music-data refresh and diagnostic improvements

The local working copy in the original development workspace may be behind GitHub. Always fetch/read `main` before making new changes. Do not assume the local branch contains the most recently API-published commit.

## Standing workflow rules

- Do not change or publish anything unless Andrew explicitly says to ship it. “Ship it” authorizes implementation, testing, version increment, and publishing.
- Increment the patch version for every shipped update: 0.7.0, 0.7.1, 0.7.2, etc.
- Run `npm test` before publishing.
- MP3 files and their tags are read-only. WaveDeck may read tags, but must never write metadata back to music files.
- Be conservative with changes. Study existing code and preserve working behavior.
- Andrew tests by pulling/running the development version from GitHub; packaging an AppImage is not normally required unless specifically requested.

## Product direction

WaveDeck’s local Music feature is part of the existing WaveDeck project and Advanced Features mode. It is not being split into a separate WaveDeck Pro repository.

WaveDeck includes:

- A portable `Music` folder beside `Data`.
- An optional second music-folder location configured in Settings.
- Recursive MP3 scanning.
- Read-only ID3/tag reading.
- A portable SQLite music index in `Data`.
- Search-based music UI rather than a folder browser.
- Song Radio, Artist Radio, and Play Album.
- Infinite radio queues. The next radio song is selected when needed, not precomputed as a fixed list.
- Albums play in track order and then hand off to Artist Radio.
- Song Radio starts with the chosen song, then continues with related/surprising music.
- Artist Radio strongly favors the seed artist according to Artist Focus, then uses related/outside music when appropriate.

Album art and ReplayGain are intentionally not part of the current feature set.

## Current radio settings

The Settings → Advanced tab currently shows nine radio controls for both Artist Radio and Song Radio:

1. Artist Focus
2. Genre Match
3. Song Popularity
4. Artist Variety
5. Album Variety
6. Release-Year Range
7. Outside Variety
8. Surprise versus Match
9. Song Repeat Wait

Important current implementation details in `src/main/music-radio.js`:

- Artist Focus uses seven values: `0, 10, 25, 50, 70, 85, 100` percent.
- Song Popularity uses the same seven values.
- Artist Variety and Album Variety currently use three values: `0, 1, 2`.
- Release-Year Range currently uses five values: `0, 5, 10, 20, 10000` years.
- Song Repeat Wait currently uses eight values from 2 hours through 24 hours.
- Outside Variety is a lane share from `0.0` to `1.0`; current balanced value is `0.161` (about 16%).
- Genre Match and Surprise versus Match are still continuous numeric controls rather than fixed-stop controls.
- Artist Focus is a direct lane decision, not merely a score bonus. At 100%, an eligible seed-artist song is selected whenever one is available; otherwise radio falls back to related music.
- Rating, favorites, play counts, mood tags, and featured-artist bonuses are not used by WaveDeck radio.
- Related-artist matching is hard-coded at a balanced fixed weight.
- Repeated A→B handoff protection is hard-coded and remembers relevant transitions for 30 days.
- A gentle post-repeat holdback remains after the normal repeat cooldown.

## Planned slider redesign

The next major tuning task is to give every visible slider a small, fixed number of meaningful stops—probably around five, though the exact number and labels must be discussed before implementation.

Goals:

- Every stop should create a noticeable behavioral difference.
- The user should see plain-English labels, not raw numeric values.
- Stops should be evenly distributed visually on the slider.
- Keep settings that have already tested well, especially Artist Focus and Outside Variety.
- Do not casually change the underlying radio behavior while only redesigning the UI.
- Use the overnight diagnostic data to choose sensible values rather than arbitrary increments.

Likely controls needing review first:

- Genre Match, because it can currently produce very large weights.
- Song Popularity, to make the relationship between Last.fm scores and selection strength understandable.
- Surprise versus Match, currently continuous.
- Song Repeat Wait, which has more stops than the user likely needs.
- Artist Variety and Album Variety, which already have only three stops but may need better labels/values.
- Release-Year Range, whose five-stop model is close to the desired direction.

Do not start this redesign until Andrew explicitly asks to proceed/ship.

## Last.fm integration

Files involved:

- `src/main/lastfm-enricher.js`
- `src/main/music-worker.js`
- `src/main/music-library.js`
- `src/main/storage.js`
- `src/renderer/settings.html`
- `src/renderer/settings.js`

Behavior:

- Optional user-controlled Last.fm API key and toggle.
- Uses Last.fm `track.getInfo` for track data and `artist.getSimilar` for related artists.
- No Last.fm account, password, or API secret is required.
- Requests are throttled to approximately one every 1.5 seconds.
- Data is stored in portable `Data/music.sqlite` tables: `lastfm_tracks`, `lastfm_artists`, and `lastfm_jobs`.
- Fresh Last.fm popularity overrides imported tag popularity in WaveDeck’s index.
- MP3 files remain untouched.
- Normal background refresh considers successful data current for approximately 183 days (six months).
- Network errors retry after about seven days; not-found results retry after six months.
- Playing a track queues its album at high priority.
- A secret `Ctrl + Alt + Shift + F` shortcut queues a library catch-up refresh.
- Since 0.7.7, that catch-up refresh skips tracks checked within the previous seven days. Restarting WaveDeck preserves queued work in the portable database.

The current Settings status text reports how many tracks are current and how many albums remain queued. The UI placement and progress reporting may be improved later, but no additional change is currently authorized.

## Diagnostic logging

The Live Radio Log opens with `Ctrl + Alt + Shift + L`.

The Save Log button exports a diagnostic JSON file. It is intended for analysis and does not include MP3 paths. The diagnostic data includes:

- Selection mode and trigger.
- Seed track and seed artist.
- Active radio settings.
- Candidate counts and cooldown/handoff exclusions.
- Artist Focus result and random roll.
- Related versus outside lane decision.
- Selected track, score, popularity value, and popularity source.
- Score additions/multipliers.
- Recent listening history.
- Leading alternative candidates.

Window size and position are remembered between launches.

## Diagnostic findings so far

### Earlier Artist Radio run

- 72 picks over about 4.5 hours from a Tom Petty and the Heartbreakers seed.
- Artist Focus at 85% produced 5 seed-artist picks out of 6 before the setting was changed.
- Artist Focus at 50% subsequently produced 33 seed-artist picks out of 66 usable decisions.
- Outside Variety was close to its configured share.
- Fresh Last.fm scores had a believable range; old embedded tag data was often saturated at 100/100.

### Overnight Song Radio run

Diagnostic file: `WaveDeck_Radio_Diagnostics_2026-09-23T10-46-47-201Z.json`

- Version 0.7.9.
- 151 selections over roughly 10.25 hours.
- Seed: The Smashing Pumpkins, with Artist Focus at 10%.
- 12 seed-artist picks (about 8%), close to target after accounting for the two-hour song cooldown.
- 116 related-lane picks and 23 outside-lane picks.
- Outside picks represented roughly 16.5% of non-seed decisions, matching the 16.1% setting.
- 128 of 151 picks had a genre match.
- 116 had a release-year match.
- Only one adjacent same-artist occurrence.
- One repeated song appeared after about 3.5 hours, respecting the two-hour minimum repeat wait.
- 99 selected songs used fresh Last.fm data; 49 used old tag data.
- Fresh Last.fm scores averaged about 64 and had zero 100/100 scores.
- Tag-based scores averaged about 92 and included 25 100/100 scores.
- This strongly confirms that the old embedded tag popularity values are the source of the 100/100 saturation problem.
- The run used a very high Genre Match value (`6162.95051`), so genre matching dominated the selection behavior. This is a tuning issue, not evidence of a code failure.
- Outside Variety intentionally produced some large genre jumps (country, pop, rap, classical, comedy, jazz) because that setting permits unrelated music.

The next useful controlled experiment is Song Radio with Song Popularity around 50%, keeping other settings unchanged, followed by another diagnostic export. However, do not make code changes solely from this recommendation.

## Recent GitHub connector history

On September 21, 2026, GitHub connector write access was verified without changing `main`:

- Branch `codex-connector-test` was created from `main` at `9099ac9`.
- `CONNECTOR_TEST.txt` was added with exactly: `GitHub write test - 2026-09-21`.
- The test branch commit was `3830e074792a21ac775b5ac5b2e3eb953997e409`.
- No pull request was opened and `main` was unchanged by the connector test.

The Advanced Features update originally existed locally as `5c7bd3e` (`Rename Pro mode and add radio tuning controls`). Because the local history had diverged from GitHub's then-current `main`, the change was replayed cleanly on top of remote `main` rather than force-pushing. The resulting published commit was `f497502938307c3015d2115fa0d27ed32135404d`. `npm test` passed before publication, and the remote tree was verified to match the tested replay.

The reliable GitHub publishing path is therefore:

1. Fetch the current remote `main` and do not trust a stale local branch.
2. Reapply or reconstruct only the intended change on top of the current remote tree.
3. Run `npm test` when source code changes are involved.
4. Create the tree and commit through the GitHub API connector.
5. Update `main` with `force: false`.
6. Fetch `main` again and verify the resulting commit, message, and tree.

## Publishing workflow

Normal `git push` may fail because the local workspace does not have GitHub credentials. The reliable publishing path is the GitHub API connector:

1. Fetch the current `main` commit and tree from GitHub.
2. Read each changed local file and base64-encode it.
3. Create GitHub blobs.
4. Create a tree based on the current remote tree.
5. Create a commit with the current remote commit as parent.
6. Update `main` with `force: false`.
7. Fetch `main` again to verify the commit and message.

Always verify the remote head after publishing. Do not overwrite remote work based only on a stale local branch.

## User communication

Andrew prefers direct, informal explanations. He wants explicit confirmation of what changed, what was tested, and the published commit. He does not want updates shipped without saying so. If diagnosing only, do not modify code.
