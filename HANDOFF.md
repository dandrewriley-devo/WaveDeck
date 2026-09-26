# WaveDeck Project Handoff

This file is an internal continuity reference for future WaveDeck work. It records the important product decisions, implementation details, testing evidence, and pending work from the WaveDeck local-music/radio development thread.

## Current published state

- Repository: `dandrewriley-devo/WaveDeck`
- Branch: `main`
- Current published version: **0.7.10**
- Current published commit: `d2a2a0243165d40e832fa4dbc87f69a71db624c1` — recent stations, Settings relocation, and read-only MP3 rating support.
- Previous relevant commit: `79fdea48f1f7eff3b71e611625a18e8485c0d689` — project handoff and connector history.
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

The Settings → Local Music tab currently shows ten radio controls for both Artist Radio and Song Radio:

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

- Artist Focus and Song Popularity use seven stops: `0, 10, 25, 50, 70, 85, 100` percent.
- Artist Variety and Album Variety use three stops: `0, 1, 2`.
- Release-Year Range and Ratings Matter each use five stops.
- Song Repeat Wait uses eight stops from 2 hours through 24 hours.
- Genre Match, Outside Variety, and Surprise versus Match use continuous numeric values.
- Genre Match and Surprise versus Match are still continuous numeric controls rather than fixed-stop controls.
- Artist Focus is a direct lane decision, not merely a score bonus. At 100%, an eligible seed-artist song is selected whenever one is available; otherwise radio falls back to related music.
- Ratings Matter defaults to Off. At other levels it weights read-only MP3 ratings in candidate scores; Dominant does not yet exclude unrated tracks. Favorites, play counts, mood tags, and featured-artist bonuses are not used.
- Related-artist matching is hard-coded at a balanced fixed weight.
- Repeated A→B handoff protection is hard-coded and remembers relevant transitions for 30 days.
- A gentle post-repeat holdback remains after the normal repeat cooldown.

## Next update queue

Andrew has asked that the following items be addressed together in the next WaveDeck update. This is a queued request, not authorization to publish that update yet.

### Make every radio slider five-stop

- Give every remaining visible slider in both Artist Radio and Song Radio exactly five discrete positions, with plain-English labels and a clear behavioral difference at each position.
- Remove Outside Variety completely from Artist Radio and Song Radio. Do not retain a probabilistic unrelated-music lane or silently fall back to unrelated tracks when the acceptable pool is empty.
- Current stop counts are mixed: Artist Focus, Song Popularity, and Song Repeat Wait have more than five; Artist Variety and Album Variety have three; Genre Match, Outside Variety, and Surprise versus Match are continuous; Release-Year Range and Ratings Matter already have five. Removing Outside Variety leaves nine controls per mode.
- Keep proven behavior where possible, especially Artist Focus and Outside Variety. Choose values using the overnight diagnostics and targeted tests rather than evenly dividing numeric ranges blindly.
- Candidate starting points discussed, not finalized: Artist Focus and Song Popularity at `0, 25, 50, 75, 100%`; Song Repeat Wait at `2, 4, 8, 16, 24 hours`.

### Ratings Matter behavior

- Keep the five labels Off, Gentle, Moderate, Strong, Dominant unless the design review changes this control.
- Higher MP3 ratings should increasingly improve a track's radio-selection weight. Preserve read-only file behavior.
- Andrew is considering a contextual thumbs-up/thumbs-down system instead of adding an in-app star-rating editor. Existing star tags can be read as metadata, but they are not contextual-fit votes. Decide whether the tag-based Ratings Matter slider should remain alongside contextual thumbs; do not conflate general song liking with fit for a particular seed.
- At Dominant, require a rating: unrated tracks must be excluded from automatic candidates. If no rated tracks remain eligible after cooldown and other constraints, do not silently play an unrated track; decide on a clear waiting/no-rated-tracks UI outcome.
- Preserve the previously discussed Moderate intent: one-star tracks are extremely unlikely and two-star tracks are rare.

### Last.fm scanning progress bar

- Replace the plain text-only scanning status with a visual progress bar and retain the useful counts/status text.
- Screenshot showed: `24,300 of 26,167 tracks current · 77 albums queued. Last.fm is checking music data in the background.` Make the bar reflect current/total, update as background work proceeds, and show queued albums separately. Handle unknown/zero totals and idle/completed states accessibly.

### Song Radio relevance problem

- Reported example: Song Radio seeded by a Beastie Boys track played George Strait. The exact decision log is not yet available, so the selection's recorded lane and candidate metadata still need review.
- Andrew's direction is to remove Outside Variety entirely and keep selections inside an acceptable pool. Remove the unrelated lane and any automatic fallback to an unrelated candidate when that pool is empty; report/wait for an eligible choice instead.
- Current code has an unrelatedTrackMultiplier lane and will choose the outside lane whenever no related candidates remain, even if the configured multiplier is zero. Genre Match only changes scores; it does not make a candidate ineligible. The acceptable-pool criteria need to be defined carefully because a broad one-tag genre overlap could still admit a bad fit.
- Relatedness currently uses same/credited artist, any genre overlap, and Last.fm similar-artist metadata. Capture an exact diagnostic to see whether George Strait was classified as related or came through the outside lane. Audit stale/broad tag data as part of that investigation.
- Do not assume more Genre Match weight will prevent out-of-style jumps. Apply eligibility boundaries before scoring and keep diagnostics explicit about why each candidate qualified.

### Contextual radio feedback concept (design investigation; not yet authorized for implementation)

- Andrew is interested in simple thumbs up/down feedback where a vote means “fits/does not fit this seed’s radio,” not “I like/dislike this song everywhere.” He prefers this to introducing a casual-use star-rating editor.
- MediaController.playMusic() stores the original seed in the music session and advanceMusic() continues to pass that same seed to each radio choice. This gives the system a stable context key for a seed → candidate feedback record.
- A useful data model would store the seed track/context, candidate track, radio mode, vote, and timestamp in portable Data. The same candidate can be downvoted for one seed and upvoted for another; do not turn a contextual downvote into a global dislike.
- A direct vote can immediately adjust or suppress that exact seed/candidate pair. Generalizing to other candidates requires meaningful features for the seed/candidate relationship—normalized track tags/genres and Last.fm related-artist data at minimum; audio similarity could be explored later. Use positive and negative examples, confidence/smoothing, and a cold-start fallback so a few votes do not distort the whole station.
- Do not infer votes from skips at first. Skipping can have many meanings. Consider an undo/change-vote path and keep all learned feedback local.
- Existing MP3 star tags describe a track-level rating, not necessarily whether it fits a particular seed. They can be a weak optional prior if desired, but should not be used as contextual training labels. Resolve the relationship between this feature and the queued Ratings Matter slider before implementation.
- First establish strict acceptable-pool selection and collect explicit votes; then evaluate whether the accumulated data is sufficient to support a real learner.



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
