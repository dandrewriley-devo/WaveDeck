# WaveDeck Opus Branch Handoff

## WaveDeck Opus 1.1.5 — Saved Local Radio profiles

- Each Song Radio, Artist Radio, and Explore Radio station now owns a saved Local Radio profile. The first start snapshots Song Familiarity, Explore distance, Song Repeat Wait, Artist Repeat Wait, and Artist Set size; every later start restores that profile before its first selection.
- The Local Radio Controls window follows the active saved station, so its sliders update when that station starts. Edits while it is playing update that station’s profile only. New stations still begin from the ordinary global defaults.
- Crossfade, Finish current song when changing stations, and the Local Mix Last.fm preference remain global. Profiles live in `Data/listening-history.json` and are validated/migrated safely.
- The visible About changelog and `package-lock.json` remain unchanged.

## WaveDeck Opus 1.1.4 — Verified AppImage rebuild

- Re-pins the moving BtbN `latest` FFmpeg archive after its October 16 replacement, allowing the AppImage build to verify the archive and its extracted recorder binaries again. Verified SHA-256 values: archive `d7f4653869dffbff91b6a321b17c617d14664d9664765cb8bec955237eaef747`; FFmpeg `689224bddf8acefc220f8d2d06012d49dde494748753e82df6efadc349ff269f`; FFprobe `cd9952e9c3dfb0a159c572705d10af198708f596ec2f52a0fac823610ae1d85a`.
- Includes the complete 1.1.3 clock-scheduled Station ID, Radio Log, and non-music-genre work. The visible About changelog and `package-lock.json` remain unchanged.

## WaveDeck Opus 1.1.3 — Clock IDs and music-only radio

- Local Radio and every Local Mix now reject tracks whose stored genre is Comedy, Stand-up Comedy, or Spoken Word. The Live Radio Log makes the rejected count visible as a non-music genre exclusion.
- Radio Log entries and exported diagnostics record the selected track’s actual stored genre tags. The existing relationship `tags` field remains the shared tags used to make the choice, not a replacement for genres.
- Played Station IDs have compact Live Radio Log and diagnostic entries with their filename, time, and pool. They remain outside normal Local Radio selections, feedback, Last.fm scrobbling, and library statistics.
- WaveDeck now creates `Station IDs/Half Hour` and `Station IDs/Top of Hour` beside portable `Data` and `Music`. At :29 it queues a random Half Hour MP3/Opus clip; at :59 it queues a random Top of Hour clip. Each waits for the active Local Music song to end, uses its own non-repeating pool, and missing/empty folders simply keep normal playback going. The earlier root `Station IDs` pool and elapsed-30-minute behavior are superseded.
- The visible About changelog and `package-lock.json` remain unchanged.

## WaveDeck Opus 1.1.2 — Station IDs

- WaveDeck creates a `Station IDs` folder beside portable `Data` and `Music`. It accepts regular `.mp3` and `.opus` files in that folder; missing or empty folders are ignored. Station IDs stay outside library scans, Opus conversion, Local Radio choices and Last.fm scrobbling.
- After 30 minutes of actual Local Music playback, an ID is chosen at the next song boundary, played completely, then the station or album resumes. Pause and internet streaming do not count toward the interval. A due ID waits for the current song to end even when Local Music crossfade is on. Consecutive IDs avoid repeating a clip when alternatives exist. An ID is skipped if its file disappears or cannot play.
- Local Music and the personal Icecast stream both hear the ID. There is no setting; adding or removing clips controls the feature. The visible About changelog and `package-lock.json` remain unchanged.

## WaveDeck Opus 1.1.1 — Editable stream address

- The Stream tab lets Andrew choose the station address name before `.mp3`, for example `andrews-radio`. It accepts 1–48 letters, numbers, or hyphens (starting and ending with a letter or number), normalizes capitals to lowercase, and saves it in `Data/personal-stream.json`.
- Existing random addresses remain valid until changed. Changing the name while broadcasting restarts the private server and source, updates the displayed address and QR code, and ends the old address. The stream stays enabled.
- Short names are easier to type and guess; the Stream tab explains that anyone with the address can listen. No visible About changelog change. Versioning moves to 1.1.1 and future small updates increment the third digit.

## WaveDeck Opus 1.0.38 — Streaming Update

- Adds a Linux-only **Personal Stream** tab in Settings. Its single switch launches and stops WaveDeck's bundled private Icecast server and encoder automatically; the user does not run a separate application.
- WaveDeck moves its two MPV playback lanes to a private PulseAudio/PipeWire-compatible bus while the stream is on. The bus feeds both Icecast and a loopback to the normal speaker. The stream always remains full volume even if WaveDeck's local volume is lowered or muted. Local Music crossfades therefore arrive at the stream intact.
- Both Local Music and ordinary Streaming stations are broadcast. Streaming metadata and Local Music artist/title updates are sent to Icecast for compatible clients such as Pladio.
- The Stream tab shows status, a stable random unlisted station path, a copy button, and a QR code. The user enters a public hostname/IP after router setup; WaveDeck uses TCP port 18037 and an unlisted 128 kbps MP3 mount for broad iPhone/CarPlay compatibility.
- The AppImage bundles Icecast and its shared dependencies. It relies on the standard Linux PulseAudio/PipeWire compatibility utilities `pactl` and `parec`, expected on Linux Mint desktop installations.
- Router configuration remains a manual follow-up: reserve this computer's LAN address, forward TCP 18037 to it, and establish either a stable public hostname or update the Stream tab's address after WAN IP changes. The random link is intentionally unlisted but it is not true listener authentication.
- Visible About changelog entry: `WaveDeck 1.0.1 - Streaming Update` (Andrew's requested name). Package/release version: 1.0.38.

## WaveDeck Opus 1.0.37

- Live Radio Log's embedded Settings tab loads its message bridge before the log renderer, restoring saved history and live decisions.
- Clickable portable song titles use the hand cursor.
- Explore Radio recents and starred presets survive disk writes/restarts; saved/listed labels shorten to “X Radio” while the start button and current station retain “Explore Radio.”
- The visible About changelog remains unchanged.

## WaveDeck Opus 1.0.36

- Renamed the visible Additional Music Folder language to External Music Folder. The Your Library card shows an External Tracks count when a folder is connected; stored folder identities, settings names, and read-only treatment remain compatible.
- Local Radio Controls adds an opt-in Finish current song when changing stations setting. New Local Radio and Local Mix choices prepare during the playing track and take over at the ending crossfade (or EOF with crossfade off); the most recent choice wins. Individual track selection, album starts, and Streaming remain immediate.
- Manage Portable Music and Live Radio Log now open as Advanced-only Settings tabs. Toolbar/Settings links, the title-to-track action, and the log shortcut route to their tabs. Their existing views are hosted in isolated lazy-loaded frames through an explicit limited Settings bridge, so the rest of Settings does not reload when they update.
- `npm test` includes queued-station handoff regressions. The visible About changelog remains unchanged.
- The release build refreshed the verified upstream FFmpeg archive and binary hashes after BtbN changed its moving `latest` asset: archive `911ce5c025b528cdc31f8101e144c980c73541859b87ef0099b5d1867a7ba1c4`, FFmpeg `a475edad4aa6be76ccabfd7238073d4f50bacae2162843ae994f970d4d71799b`, FFprobe `f06aa8ef7798b63aa9f2dc47f7762d1b761875b04dbf5f12df0e327f1fcda0d3`.


## WaveDeck Opus 1.0.35

- Local Radio decision-making now runs in its own ordered worker thread with a library snapshot that is sent only when tracks or enrichment change. Expensive artist searches no longer block Electron's UI, playback, or equal-power crossfade timers. Switching stations cancels obsolete work; opening seeds, Artist Sets, feedback, deferred Live Radio decisions, and history persistence retain their ordering.
- The prepared-next handoff awaits any selection already in flight instead of starting a second choice. It also consumes prepared album songs before the rest of the album queue. Preparation diagnostics distinguish worker scoring time from total selection and file-resolution time.
- Manage Portable Music caches its artist, release-count, rating, and search index across queries. Track edits update just the affected artist, and a jump from the playing title reuses the initial artist-list request while loading that artist's releases in parallel. Last.fm metadata has a separate cache revision so enrichment does not repeatedly invalidate Local Mix readiness.
- `npm test` now includes large-library index/worker responsiveness, prepared worker playback, in-flight EOF, and album-order regressions. This is an internal performance update; the visible About changelog remains unchanged.

## WaveDeck Opus 1.0.34

- Fixes a 1.0.33 crossfade regression. Selecting the next fresh Local Radio move can scan a very large library synchronously. 1.0.33 could start that selection one second into the current eight-second equal-power fade, blocking the same main-process timer that raises the incoming lane’s volume. The track could therefore advance silently and become audible in the middle.
- Preparation now waits until the active crossfade has fully completed, plus a small safety margin. The next move still has the rest of the newly started song to prepare, while the audible handoff remains uninterrupted. A regression test proves no next-track preparation can occur during that fade.

## WaveDeck Opus 1.0.33

- Fixes the real prepared-transition defect in Local Music. A prepared choice used by an eight-second crossfade now carries its deferred Live Radio decision through to the new track and clears the pending state. Previously that decision was left pending, which silently prevented every later track from being prepared; fresh artist moves then had to search the full library at the crossfade boundary.
- Prepared choices now resolve their portable file path before the handoff and reuse it for either a normal advance or crossfade. The saved diagnostic decision includes internal preparation timing (selection, resolve, and total milliseconds) plus whether it was used by advance or crossfade, so future logs can verify the path is active.
- Explore Radio stations are now retained in Recently Played Local Stations and can be starred as presets, just like Song and Artist Radio.

## WaveDeck Opus 1.0.32

- Portable tracks now retain a persistent `radioIdentity` in `Data/music.sqlite`. It makes album/box-set/compilation copies of the same song one stored radio choice, so Artist Set planning does not repeatedly compare an artist’s entire candidate pool.
- Existing portable libraries receive an idle, worker-thread identity rebuild after Local Music is already available. New imports, conversions, rescans, and portable metadata edits mark identities for an automatic background refresh. This work never alters audio files or tags.
- Artist Set planning retains near-title safeguards without quadratic work. It uses compact title signatures for newly arrived tracks and stored identities thereafter; a 12,000-track artist pool is covered by regression tests.
- Internal maintenance shortcut: `Ctrl+Alt+Shift+I` forces a complete portable identity rebuild and reports its completion. It is intentionally not exposed in the normal UI.
- The mutable BtbN `latest` FFmpeg archive changed on Oct. 14. 1.0.32 pins the verified archive hash `80742938a95f9ecf9e0635192b417b7af61ddd53c4ab511898a11da5dad81667`, with `ffmpeg` `00550c65fc35d8e21acae12c4262bdbf74df9b79fa996eb71c85a014571d8542` and `ffprobe` `effc9977f8dcb67e8f459822138b0663c44434aafaf4fef058b5c67dfb6dd8c4`.

## WaveDeck Opus 1.0.31

- Local Radio and Local Mix selection no longer repeatedly search the complete playback history for every track in a large library. Repeat protection now uses in-memory song-identity and artist indexes, preserving same-song/near-duplicate safeguards without blocking the app at the end of a song.
- While a Local Music track is playing, WaveDeck prepares one upcoming station move (a single track or the already-planned Artist Set continuation). The prepared choice is used at the transition, including a manual skip or crossfade. Thumbs-up and ordinary skips do **not** replace it; their feedback applies to the next fresh choice. Station changes still discard it.
- The Live Radio Log and playback history now save asynchronously in coalesced background snapshots (at most every five and two minutes respectively) rather than synchronously rewriting their complete JSON files at every track transition. Both flush during a normal quit. This keeps USB-backed playback responsive while retaining the same persistent log/history behavior.

## WaveDeck Opus 1.0.30

- Portable Music Manager releases can be marked **Holiday Music**. WaveDeck writes `HOLIDAY=1` to every portable Opus track on that release, preserves it through optimization and duplicate cleanup, keeps it out of ordinary automatic Local Radio and Local Mixes, and reserves it for Holiday & Christmas. Manual playback remains available.
- Artist identity now normalizes harmless typographic punctuation, so names such as `Jane's Addiction` and `Jane’s Addiction` share Music Manager grouping, Last.fm relationships, repeat protection, and Local Radio eligibility.
- Compound broad tags such as `Rock, Pop` are split before eligibility is evaluated; broad genres can no longer masquerade as a specific Radio relationship.
- Artist Sets and repeat protection now conservatively recognize same-artist, near-identical titles with nearly identical running times as the same song. This prevents variant spellings such as Smokey/Smoky Mountain Rain from landing together.
- Emergency exact-song recovery now uses each fallback song only once per station, preventing endless small loops after every connected route is exhausted. Explore-log active anchors now retain the actual artist while continuing a planned Artist Set.
- The moving BtbN FFmpeg archive was re-verified for this AppImage build: archive `f632249a99c08789190ae1c3bc94d1b53e093039b72e93815e8ed5d2a4a61eb8`; extracted `ffmpeg` `e5906b59bb42f4b8cd356d47042d0bc6f62c95a392f90bda8d3b69849d730f23`; extracted `ffprobe` `91cf4daf79e376b8e3019252a0edf0dd244adeff15bc5f4a54f6f58911eeb73f`.

## WaveDeck Opus 1.0.29

- Explore Radio now treats a complete Artist Set as one move along its related-artist route. The first song establishes the route; the remaining planned songs keep that anchor and hop distance, then the next fresh choice returns toward the original seed when appropriate.

## WaveDeck Opus 1.0.28

- Song Radio and Explore Radio now include the manually selected seed as track one of the first Artist Set. The set is planned before playback starts, shortens cleanly when the artist does not have enough distinct eligible songs, and appears on the seed’s Live Radio Log entry.
- Clicking the title of a currently playing Portable Music track opens Manage Portable Music directly to that artist, release, and track. The row is briefly highlighted. Streaming and Additional Music Folder titles remain unchanged and do nothing.

## WaveDeck Opus 1.0.26

- Artist Sets now use a normalized artist-and-song identity, so the same ordinary song from a box set and a greatest-hits compilation is never proposed twice in one set and shares the Song Repeat Wait across copies. Meaningful versions such as Live, Acoustic, and Demo remain distinct.
- Planned Artist Sets are resilient: if one planned track becomes unavailable, it is skipped and the rest of the set continues. The station moves to a new artist only after every remaining planned track is unavailable. Live Radio Log entries now explain any skipped or early-ended set track in plain language.
- The Station Seed log card now labels Seed song, Artist, and Album separately.
- Local Radio Controls now includes the compact reminder: “Starting a new station resets artist rest. Song rest carries over.”

## WaveDeck Opus 1.0.21

- This is the separate **`opus-portable`** branch. It is a Linux-only personal edition; `main` remains the normal cross-platform WaveDeck product.
- Release artifact: **`WaveDeckOpus.AppImage`**. Its release workflow is `.github/workflows/opus-portable.yml` and publishes tag `opus-v1.0.21` without touching the main WaveDeck release.
- WaveDeck Opus changes only the sibling portable `Music` folder. The optional Additional Music Folder is always read-only.
- Portable MP3, FLAC, M4A/AAC, WAV, WMA, and OGG sources are converted one at a time in the background to 96 kbps Opus. Each output is validated before its source is removed. Existing valid Opus outputs and `.opus.part` recovery files are handled safely at the next pass.
- Only these tags are carried into Opus: title, artist, album, Album Artist, track number, disc number, year, genre, `RATING`, `FAVORITE`, `DO_NOT_PLAY`, and `AMP_TRACK_ID`. Embedded artwork, loose image files, lyric/sidecar files, and other metadata are intentionally discarded from the portable Music tree.
- Portable MP3 and Opus counterparts share the same logical track ID, so Local Radio station history, feedback, and Last.fm data survive conversion. Do not change `src/main/music-tags.js` identity behavior casually.
- `src/main/opus-optimizer.js` owns conversion, validation, crash recovery, source protection for the currently playing song, and portable-Music watching. It uses the bundled, pinned FFmpeg/FFprobe pair already used by Linux recording.
- 1.0.1 separates optimizer-progress IPC from real library-change IPC, preventing the Local Music tab and list from flashing during conversion. The optimizer ignores its own file-watcher events, then rescans once when a batch completes. Settings now separates Additional Music Folder from Portable Music and shows total conversion progress without a stale track name.
- 1.0.2 tightens the Local Music Settings page: Last.fm uses an inline Refresh link, stable MUSIC DATA UPDATED/UPDATING line, and no explanatory clutter or Radio Log link. Portable Music wording is shorter and clearer.
- 1.0.3 remembers Additional Music Folders per Linux computer in `Data/computer-music-folders.json`. New choices stay temporary until the user selects the inline Remember this computer link; no popup is used. Existing single-folder settings migrate to the first computer that opens this release.
- 1.0.4 starts an Additional Music Folder scan immediately after selection and visibly reports scan activity. The Local Music settings page shows the current computer’s Additional Music track count, lists all remembered computers, and lets the user rename or forget each remembered computer inline.
- 1.0.5 makes Remember this computer immediate; it never re-applies the folder or waits behind scans. Additional Music indexes MP3 and Opus, has its own Refresh action, and portable copies suppress matching Additional Music duplicates. Import to Portable Music reads the AMF only, previews missing supported files with space estimate, then writes validated 96 kbps Opus directly to portable Music with progress and approximate remaining time. Portable Music shows a compact green-used/light-gray-free drive chart. Manage Local Mixes is collapsed by default.
- 1.0.6 imports by clean tag-based folders instead of the source tree: Album Artist/Album, Various Artists for compilations, Soundtracks for clearly labeled soundtracks, and Loose Tracks when album tags are absent. Existing artist/album folder casing is reused case-insensitively. Imports preserve a 3% free-space reserve (97% maximum used), refresh the index every 30 completed files, and do one Local Mix refresh at the end. Import watcher churn is suppressed. Local Music starts from its database immediately, then quietly checks files in the background without clearing the displayed results; Mix updates likewise wait until analysis is complete. The portable-drive donut now has an orange (`#e7541f`) used slice, light-gray free slice, and a 50% thicker ring.
- 1.0.7 counts only distinct visible Local Music tracks, runs portable imports with a USB-safe two workers or Fast-drive six workers setting, and performs a non-blocking index refresh only every 300 completed imports plus the final refresh. Settings opens the new Opus-only Manage Portable Music window. It is an album-first manager with Artist/Genre/Needs Attention browse views, search, direct 1–10 ratings, Favorite and Do Not Play controls, editable Opus song details, and personal artist relationships in `Data/artist-relationships.json`. Personal relationships are reciprocal and supplement—never overwrite—Last.fm relationships. Additional Music remains read-only.
- 1.0.8 adds a Turbo import setting that runs 12 conversions at a time. Import speed changes apply immediately during an active import: increasing speed starts more conversions right away, while slowing down finishes the files already underway and then uses the lower limit.
- 1.0.9 makes the saved Local Music index the launch experience: existing tracks, searches, and saved Local Stations are ready from `music.sqlite` instead of waiting for a complete filesystem scan. A quiet verification/optimization pass waits for three idle minutes and only reloads the UI or reassesses Local Mixes when the index genuinely changed. Importing keeps the last completed Mix availability stable and runs one final assessment afterward. Local Station history is scoped to the portable library or its remembered Additional Music Folder profile; unavailable unstarred recent stations are pruned automatically, unavailable saved stations are hidden until their library returns, and a small × removes an individual recent entry.
- 1.0.10 fixes the Local Mix startup race by restoring valid saved mix availability immediately and refusing stale empty renderer results. Settings → Local Music is now a responsive dashboard: portable-library count, storage and Last.fm donuts, import, Additional Music Folder, Local Mixes, and remembered computers are laid out as cards. The 2-column layout keeps Additional Music Folder and Remembered Computers together, then places Local Mixes full-width above its expandable manager.
- 1.0.11 aligns and enlarges the dashboard donuts, improves the two-column card ordering, and makes Import and Local Mixes read at a glance. Import now shows the ready-track count and rounded required/available space, disables itself when the 97%-capacity rule would be exceeded, and uses short USB/FAST/TURBO speed labels. Local Mixes shows enabled-ready versus viable-ready counts.
- 1.0.12 refreshes the pinned FFmpeg build hashes used by the AppImage release workflow so GitHub can build and attach the release download again.
- 1.0.13 replaces the Portable Music Manager's album-card modes with one fast, virtualized artist list. It searches artist, release, track, and genre while retaining artist rows; one artist expands at a time to Last.fm and personal related artists, releases, then compact playable track rows with duration, Last.fm popularity, 1–10 rating, Favorite, Do Not Play, and editable Opus details. Artist capitalization variants are grouped together. The two dashboard donuts now share a fixed visual top alignment.
- 1.0.14 preserves each track's release tag when saving inline song edits in the new manager.
- 1.0.15 makes Music Manager ratings, Favorite, and Do Not Play controls update immediately without a full library rescan. Their Opus-tag writes are queued in the background. Artist expansion now preserves list position and measures its natural content height, so releases/tracks use the window scroll instead of an internal detail scrollbar.
- 1.0.16 lists Music Manager releases chronologically and shows their tagged year, such as `Dirt (1992)`. During WaveDeck Opus's quiet background optimization, exact same-release copies are audio-fingerprinted, the original unsuffixed/oldest copy is kept, personal rating/Favorite/Do Not Play settings are merged into it, and matching extra Opus files are removed. Future imports already skip matching portable tracks.
- 1.0.17 replaces the narrow same-release duplicate gate with a resumable, whole-portable-library decoded-audio fingerprint cache. It safely removes audio-identical Opus copies even when their tags disagree, retaining the unsuffixed/oldest copy and merging the highest rating, Favorite, and Do Not Play values. `Data/opus-dedup-diagnostics.json` records every cleanup run, cache progress, verified duplicate group, retained/deleted path, merged personal tags, deferred currently-playing file, different-audio same-copy-name group, and read/removal failure. It checkpoints the fingerprint cache every 1,000 new files, then only fingerprints new or changed files on later passes. This file is intentionally diagnostic data for Andrew/development use, not end-user UI.
- 1.0.18 adds a safe practical second cleanup rule after the exact-audio check: within the same copied filename group, files are also considered the same released track when normalized artist, album, title, and track number match and duration is within one second. Missing Album Artist and disc values are ignored. The unsuffixed/oldest copy is kept and WaveDeck metadata is merged. Differing-audio, weak-tag matches remain recorded but untouched. Invalid Opus fingerprint failures are remembered by file size/modified time and are retried only after the file changes, preventing ten-minute background churn. Manage Portable Music now remembers its normal size and screen position.
- 1.0.19 adds the Local Radio Controls toggle **Favor Last.fm Data for Local Mixes**. When enabled, a Local Mix still obeys its format book, Do Not Play, artist sets, and repeat waits, but only tracks with Last.fm popularity can play and the weighted choice is strictly that popularity—ratings, Favorites, feedback, and familiarity do not influence it. Main-window Local Music searching now uses a persisted FTS index containing only visible tracks, enriches only returned results, and can run between background scan filesystem operations rather than waiting for a full scan.
- The 1.0.19 AppImage refreshes the pinned upstream FFmpeg/FFprobe hashes after BtbN's moving `latest` archive changed again. The archive and both extracted binaries were verified before updating the pins.
- 1.0.20 adds native Local Music scrobbling. Settings → Local Music → Last.fm Music Data has a one-time Connect Last.fm link; it opens the normal browser authorization page, stores the resulting portable session in `Data/lastfm-scrobbling.json`, sends Now Playing, scrobbles after 30 seconds and half the song or four minutes (whichever comes first), and retains unsent scrobbles for later. It also adds Explore Radio: a related-artist route that moves outward one, three, or six artist hops before returning toward the seed. Its control is **How Far Should We Stray From the Seed?** with Close to Home, Take a Detour, and Go Exploring. The Last.fm enrichment donut now smoothly shifts red → orange → gold → green as the percent enriched rises; the portable-storage donut remains unchanged. It also refreshes the BtbN FFmpeg/FFprobe checksums after upstream moved its `latest` archive again.
- 1.0.21 makes artist-repeat protection station-specific: starting any new Local Radio station clears the prior station’s artist-rest list while exact-song repeat history remains intact. Explore Radio now performs a small (at most three-hop) Last.fm related-artist rescue search from the original seed when its current route is exhausted, rather than immediately waiting. While an Explore route is away from its original seed, the gold current-station label changes to orange and returns to gold at the seed. Explore Radio thumbs-up is enabled in both the main player and Mini Player.
- The 1.0.21 AppImage refreshes the pinned FFmpeg/FFprobe hashes after BtbN updated the moving `latest` archive again. The verified archive SHA-256 is `e4fba844d3451bd9b386dd007180a3db0ac343909d7796b0600eb4845b442aab`; extracted `ffmpeg` is `e35727315569a41ca0d13726648c96ae33a040e108f1bc25de1529cd4e257ea2`; `ffprobe` is `2d06053fcdfb69bdbe844fd8ff725a9a960af83ffad21f665d81c0c666234c0b`.

## WaveDeck Opus 1.0.22

- Live Radio Log now adds a human-readable **How it was picked** section above the technical fit details. New selections explain the station seed, related artists actually available in the library, artist-repeat protection, eligible-track count, the selected track's Last.fm popularity/personal rating/Favorite/feedback factors, and any Explore Radio hop, return, or rescue route. Older saved entries remain readable and simply identify that this newer story was not recorded yet.

## WaveDeck Opus 1.0.23

- Local Radio now treats artist-set length as a preference instead of a reason to stop: a requested four-play can safely shorten to three, two, or one playable track. Song Radio and Explore Radio use a station-family recovery ladder before ever easing repeat protection: they walk at most three Last.fm-related-artist hops from the original seed, never use broad genre matching, then only relax artist rest and finally exact-song rest inside that verified family. `DO_NOT_PLAY` remains absolute. An exact-song emergency choice is the least recently played credible family track. Any rare no-pick decision is now persisted in the Live Radio Log with its blocking counts. While Song Radio is using a related-route recovery, its station label turns orange. The Log identifies artist-set position (for example, track 2 of 4), shortened sets, route hops, and any eased protection.

## WaveDeck Opus 1.0.24

- Last.fm desktop authorization no longer silently falls back to its disconnected state while Last.fm is still approving or briefly propagating the session. It keeps checking for the full authorization window, retains the exact session-check/connection message across restart, and shows it in Settings instead of hiding it. Once connected, Settings names the actual Last.fm account and remembers the most recently accepted scrobble, so there is a clear confirmation that the connection and scrobbling path work.

## WaveDeck Opus 1.0.25

- Last.fm session persistence now preserves opaque saved session keys across restarts and visibly reports unreadable saved connection data instead of silently presenting a disconnected state.
- The Local Music toolbar now opens the Library Manager. The Your Library card has compact Manage, Refresh, and View Log links.
- Live Radio Log cards now show active Local Radio Controls, the actual Song Familiarity effect, concrete Rejected Tracks counts, and—on the first track only—a compact Artist Sets card with the complete proposed artist set. How it was picked and Score Adjustments state exactly when stored thumbs-up feedback or a liked secondary seed affected the choice.
- The verified pinned BtbN FFmpeg archive for the AppImage release is now archive `ad8ac3c3ebc161a2feaa3289f91de9418bc4b8a7e28b335235c3ab4c037a5899`; extracted `ffmpeg` is `2e590909abcb2059cc3d1f839b53c8ffd82fe9122a5560f042e09e21ffbf50c7`; `ffprobe` is `8873050ba193b5dc82529dddb437f7423dcb4842a1a3fd21ef4eaa1856fbf33f`.

# WaveDeck Project Handoff

This is the internal continuity reference for future WaveDeck work. See the Opus release sections above for updates through **1.1.5**.

## Current published state

- Repository: `dandrewriley-devo/WaveDeck`
- Branch: `opus-portable`
- Current version: **1.1.5**
- Current release: 1.1.5 — saved per-station Local Radio profiles with slider restoration.
- Current commit: the 1.1.5 release commit at the head of `opus-portable`.
- 0.11.8 commit: `8118e235eed4b4a18c378f12ced8a86be83ed4b9` — monitor-safe main-window bounds persistence and portable Windows build.
- 0.11.7 commit: `c8b69b7b8842dd6c310dda05b22b8d52870d3e84` — superseded source correction after the first portable Windows build.
- 0.11.6 commit: `621e44d8c484cd0a4d70eb124106170f6183d0ae` — compact Local Radio Controls and remembered auxiliary-window bounds.
- 0.11.5 commit: `f6422b1c3fe88b1de62bc1e5bfcf06ce6a35763c` — tray icon and opening Local Radio diagnostic entries.
- 0.11.4 commit: `7b2abb3a5b6ef5ce2a2a4286664a88f1e293a10b` — Local Radio Controls and Live Radio Log ordering.
- 0.11.3 commit: `883bf5f345a4d185b576ed10b99eacc15d34b5b0` — Local Music loading and persistent Live Radio Log.
- 0.11.2 commit: `edc074cdb908a1f9cdcf5e1c7abbfc2d8ed0bb4b` — expanded in-app User Guide, compact station-list listening totals, and left-aligned subgroups.
- 0.11.1 commit: `e07a29d219dd93686351f45577ec331c61cd108f` — closing the main window closes Settings and Live Radio Log before fully exiting.
- 0.11.0 commit: `f3d51b2f42369f6bd301d4677bde14748e1d1da4` — true Artist Radio and album-to-Artist-Radio handoff.

Always fetch and read remote `main` before changing anything. The original scratch checkout can be stale or have unrelated edits.

## Standing workflow rules

- Andrew must explicitly say **“ship”** or **“ship it”** before any code changes or publishing. That approval covers implementation, testing, version increment, and direct publishing.
- Publish directly to `main`; do not open a pull request.
- Increment the patch version for every shipped update.
- Run both `npm test` and `git diff --check` before publishing.
- Verify the actual remote `main` version and changed files after publishing.
- Andrew's normal desktop icon/updater pulls and runs the source from GitHub `main`. GitHub Releases publishes the portable Linux AppImage and Windows EXE when a version is shipped; neither release artifact replaces the shared `Data` or `Music` folders.
- MP3 files and their tags are read-only. WaveDeck may index them, but must never write metadata back to them.
- Do not change `package-lock.json`. It is unusual/binary in this project and is not part of normal source updates.
- Small internal or cosmetic releases do not need a new visible changelog entry unless Andrew asks. The About tab’s newest visible entry is the intentionally blank heading `WaveDeck 1.0 - Full Release - Oct 2, 2026`.

## Publishing safely

Normal `git push` may not have credentials. The reliable route is the GitHub API connector:

1. Fetch remote `main` and its tree.
2. Use a clean detached worktree based on that exact commit.
3. Create blobs only for intended changed files, create a tree from the current remote tree, create a commit with that remote commit as parent, then update `main` with `force: false`.
4. Fetch the new remote files and commit to verify the version and critical source text.

Important: do **not** let a large base64 file be truncated while creating a GitHub blob. The 0.11.2 publish accidentally replaced `scripts/validate.js` with truncated binary data because the command-output budget was too small. 0.11.3 restores the full verified JavaScript file. For a large file, request enough output capacity (at least 60,000 output tokens for the current ~105 KB validation script) and verify the resulting remote file is readable JavaScript before declaring the release complete.

## Product language and scope

- Use **Local Music** and **Local Radio** for MP3-library features.
- Use **Streaming** and **Streaming Radio** for internet streams.
- Advanced Features controls access to Local Music, recording, and related settings. When it is off, ordinary Streaming playback controls still remain present and work.
- The Notepad feature is gone and should not be restored.
- Album art and ReplayGain are intentionally not in scope.

## Local Music and index

- WaveDeck creates and scans the portable `Music` folder next to `Data` and one optional Additional Music Folder. Scanning is recursive for MP3s.
- `Data/music.sqlite` is the portable read-only music index. `src/main/music-worker.js` owns its SQLite access; `src/main/music-library.js` is the main-process wrapper.
- Indexed useful tags include title, artist, album, Album Artist, year, genre, ratings, Favorite, and Do Not Play.
- Custom MP3 `RATING` is on a **0–10** scale: 10 = five stars, 5 = 2.5 stars, 0/unset = unrated. Existing MP3 rating values remain read-only.
- `FAVORITE=1` is a strong personal preference signal.
- `DO_NOT_PLAY=1` is an absolute exclusion from Local Radio, Local Mixes, albums, and manual Local Radio starts.
- Local Music is warmed in the background as soon as Advanced Features is enabled. The Local Music tab now immediately shows “Loading your Local Music library…” if the first view is not ready—important for Andrew's 40,000+ track library.
- Blank Local Music view data (song count/search shell, recent Local Stations, and enabled Local Mixes) is cached after warm-up and invalidated when music, history, mixes, or Local Music toolbar visibility changes.

## Local Radio policy

### Song Radio and Local Mixes

- Song Radio begins from its selected seed and only considers credible musical relationships: seed artist/album, shared credited artists, specific useful tags, and useful Last.fm similar-artist links.
- Broad tags such as Rock, Pop, Country, or Jazz alone never make a song eligible. If no credible choice exists, Local Radio waits rather than making a bad leap.
- Local Mix format books are the eligibility authority; Last.fm can rank an allowed choice but cannot add an unapproved artist to a mix.
- Song Familiarity affects odds only among songs that already fit:
  - Play Deep Cuts Too: Favorites and ratings 3–10 lead when available.
  - Balanced Mix (default): Favorites and ratings 5–10 lead when available.
  - Favor the Hits: Favorites and ratings 7–10 lead when available.
- If that personal pool is empty, Last.fm popularity/familiarity can help; missing popularity is neutral. Personal ratings and Favorite tags take precedence over public popularity.
- Persistent tuning controls: Song Repeat Wait has 1–24 hour stops (default 4); Artist Repeat Wait has 30, 60, 90, 120, and 180 minute stops (default 90); Artist Sets are Single Tracks, Two-fers, Three-way, and Four-play (default Single Tracks). Artist Sets are planned before the first song; if the requested length is unavailable, Local Radio safely shortens the set rather than pausing playback.
- The Song Familiarity slider increases toward the right: Play Deep Cuts Too → Balanced Mix → Favor the Hits.

### Artist Radio and albums

- Artist Radio is deliberately distinct from Song Radio: it plays about **90%** from the selected artist, with only an occasional eligible related-artist change. It uses a fixed balanced profile rather than Local Radio slider tuning.
- If the seed artist has no eligible song, Artist Radio waits; related artists never take over.
- Play Album follows track/disc order. At the end of an album with a clear non-compilation Album Artist, it transitions into Artist Radio. Various Artists albums stop at the end.

### Feedback and station memory

- Local Radio feedback is contextual, stored by station key and song key in `Data/local-radio-feedback.json`.
- Thumbs-up gently improves the odds of the current song for that Local Station/Mix. A skip is a softer negative signal; normal completion is neutral. There is no visible thumbs-down button.
- In Song Radio, positive tracks can act as soft secondary seeds without replacing the original seed.
- Recent Local Stations are stored in `Data/listening-history.json`, with Local Station Presets saved by a star. Local Mix stars move favorite mixes to the top. The Local Music Presets section combines every starred Local Station and Local Mix in visually identical rows; the originals remain in their normal lists. The Local Music toolbar supports Presets, Favorites Only, and Local Mixes.

## Local Mixes

- Built-in/portable books live in `Data/local-mixes`. The 42 expanded format books are bundled with the original mixes and appear when eligible; additional listener-supplied JSON books are detected automatically but remain hidden until enabled in Settings → Local Music.
- A Local Mix must have at least **20 eligible tracks** to appear. The manager labels readiness: Not Enough (0–19), Weak (20–49), Solid (50–149), Strong (150–399), Excellent (400+), using a red-to-green visual gradient.
- Current shipped mixes: Classic Rock, Grunge Era Rock, Classic Hits, Alternative ’80s, Rock and Metal, Classic Country, and Wild Card Radio. Yacht Rock was intentionally retired.
- Classic Rock includes Southern Rock and Heartland Rock material. AC/DC is accepted through all albums, including `Black Ice` (2008); legacy `AC` parsing is normalized to `AC/DC`.
- Wild Card Radio has no artist roster; it uses the strongest personal ratings/Favorites across the library, then Last.fm popularity if no personal taste data exists.

## Crossfade and playback

- Local Music only has a real equal-power **8-second crossfade**, enabled by default and switchable in Local Radio Controls. Streaming Radio is unaffected.
- Crossfade applies to Local Music, Local Radio, Local Mixes, and albums. A candidate is selected in advance and committed only after it starts successfully. Skip, stop, error, station change, and exit cancel it safely.
- Main playback controls and the current-station row are global, above the tabs. The current-source row uses a boombox for Local Music and radio icon for Streaming.

## Last.fm

- Last.fm uses WaveDeck's bundled read-only API key and a user-controlled toggle in Settings → Local Music. Never add the Last.fm API secret to the app or repository.
- It reads `track.getInfo` and `artist.getSimilar`, storing popularity, tags, and similar artists in `Data/music.sqlite` (`lastfm_tracks`, `lastfm_artists`, and `lastfm_jobs`). It never writes to MP3s.
- Successful data remains current about six months; network failures retry after about seven days; not-found results retry after six months.
- A full catch-up refresh is started with the visible Settings button. The progress bar and “Updating Music Data” indicator prevent accidental duplicate refresh attempts.

## Live Radio Log

- Open with the subtle Local Music Settings link or `Ctrl + Alt + Shift + L`.
- `Data/radio-diagnostics.json` persistently keeps the last **3,000** selected Local Radio decisions across app restarts and Local Station changes.
- As of 0.11.3, every selected Song Radio, Artist Radio, or Local Mix decision is appended and saved even while the Live Radio Log window is closed. As of 0.11.4, opening the window presents that saved history newest first, matching live updates. As of 0.11.5, the manually selected opening track in Song Radio and Artist Radio is recorded after playback begins and is clearly labeled as the selected seed track. Save Log exports the complete history.
- Starting another Local Station no longer clears history. Clear in the Live Radio Log now clears the real persisted diagnostic history as well as the screen.
- The obsolete “Waiting for the next radio pick” empty-state box is removed.
- Diagnostics intentionally omit MP3 file paths. They include selection mode/trigger, seed, tuning, candidate counts/exclusions, qualification reasons, score inputs, top alternatives, and recent Radio history.
- Main, Settings, Live Radio Log, and Local Radio Controls window size and position are remembered. Saved bounds are constrained to the usable display when moving between computers or monitors.

## Settings and Streaming UI

- General has the app version, Sidebar Mode launch option, and Enable Advanced Features toggle.
- Streaming Stations supports station editing, search, Favorites, Presets, Station Gain, listening history, import/export/replace, and automatic library updates.
- Station Gain is per station (−12 dB to +12 dB); the Global volume slider remains separate.
- Station list rows can expand briefly for details and gain adjustment, then collapse automatically. Dragging Presets is restricted to the station title area so sliders can be adjusted normally.
- Streaming group headings stay present; station lists collapse by subgroup rather than hiding an entire major group. Group/subgroup organization follows Settings ordering.
- Linux Application Shortcut wording is generalized for Cinnamon/Mint, GNOME, KDE Plasma, Xfce, and most mainstream Linux desktops. Remove that Linux-specific section if the app is later repackaged strictly for Windows.
- WaveDeck has a system tray icon while it is running. Clicking it brings the main window forward; its menu offers Show WaveDeck, Play / Pause, Stop, and Quit WaveDeck. The window close button still fully exits WaveDeck and removes the tray icon.
- Linux and Windows have Mini Player: a 32-pixel, title-bar-height frameless always-on-top bar with Previous, Play/Pause, Stop, Next, Mute, and Local Radio thumbs-up. The tray menu and `Ctrl + Alt + Shift + M` toggle it. Clicking the text switches between Now Playing (song and artist) and Station / Local Mix; only the far-left grip drags it horizontally. Right-click its surface to use Exit Mini Player, then a divider, then one color group: Default, White, Chiefs, Army, Cherry, Gray, Denim, Rosewood, Sapphire, Bamboo, and Aloe. The Mini Player's color selection persists separately from the rest of WaveDeck. It has no track-text hover popup. Entering it from Sidebar Mode creates the ordinary window hidden, so only the Mini Player remains visible. It snaps to the top edge, persists its horizontal position in portable Data, and returns to the prior Normal or Sidebar view.
- Local Radio Controls has no in-window heading or explanatory paragraphs: its native title provides the context. Song Repeat Wait is labeled “Don't play the same song for how long?” and has only its moving hour value below the slider. Artist Repeat Wait is labeled “Don't play the same artist for how long?” and retains its five stop labels. The window remembers its size and position in portable Data and safely constrains restored bounds to the available display.
- The portable Windows build bundles the pinned x64 `mpv.exe` playback engine and the compiled Windows Sidebar helper. Both `WaveDeck.exe` and the Linux AppImage use the same sibling `Data` and `Music` folders.

## About tab

- The About tab has an extensive built-in User Guide, not the old eight short blurbs.
- It covers portable data, Streaming, Local Music, MP3 tags, Local Radio, Artist Radio, albums, Local Mixes, feedback, tuning, crossfade, Last.fm, Live Radio Log, import/export, recording, media keys, Linux launcher/sidebar/Mini Player behavior, troubleshooting, and notices.
- It intentionally excludes the removed Notepad feature.
- The visible simplified changelog is the exact high-level list Andrew supplied, with the intentionally blank top heading `WaveDeck 1.0 - Full Release - Oct 2, 2026`. Do not add release bullets beneath it unless Andrew asks. The centered italic line below the changelog is `"Whatever you do, do it all for the glory of God."`

## Key files

- `src/main/main.js` — Electron lifecycle, windows, IPC, persistent diagnostics, Last.fm and Local Music wiring.
- `src/main/media-controller.js` — Streaming/Local playback transitions, album handoff, crossfade scheduling.
- `src/main/music-radio.js` — eligibility, scoring, repeat/set rules, feedback, and diagnostics.
- `src/main/music-library.js` / `src/main/music-worker.js` — portable SQLite index, scans, queries, Local Mix analysis.
- `src/main/local-mixes.js` — format-book discovery and eligibility.
- `src/main/listening-history.js` — Streaming statistics and recent/preset Local Stations.
- `src/main/storage.js` — portable preferences and UI state.
- `src/preload.js` — renderer bridge; keep IPC surface deliberately explicit.
- `src/renderer/renderer.js` / `styles.css` / `index.html` — main player UI and Local Music warm-up/loading state.
- `src/renderer/radio-log.js` / `radio-log.html` — diagnostic history UI and export/clear actions.
- `src/renderer/settings.html` / `settings.js` / `settings.css` — Settings, User Guide, Last.fm controls, and mix manager.
- `src/renderer/local-radio-controls.html` / `.js` / `.css` — compact Local Radio Controls window for crossfade and Song Radio/Local Mix tuning.
- `src/renderer/mini-player.html` / `.js` / `.css` — Linux and Windows always-on-top compact playback controls.
- `scripts/validate.js` — static validation. This was restored in 0.11.3 and must remain valid UTF-8 JavaScript.
- `scripts/test-music.js` — music/Local Radio regression tests.

## Verification expectations

- `npm test` runs `node scripts/validate.js && node scripts/test-music.js`.
- Also run `git diff --check`.
- Test source version in `package.json` and the About version span must match.
- When reviewing the Live Radio Log, start Local Radio, let several transitions occur with the log closed, then open it and confirm the earlier decisions appear; Save Log should export them all.
- With a large library, the first Local Music click should immediately show the loading message if warming is unfinished, then show Local Stations/Mixes once ready; later openings should normally be immediate.
- With Local Music selected, the sliders icon at the left of playback controls opens Local Radio Controls. Check that its crossfade toggle and all four tuning controls persist, and that it closes with the main app or when Advanced Features is disabled.
- Confirm the main Streaming / Local Music tab reopens exactly where it was left; when Local Music is unavailable, it safely opens Streaming instead. On Linux and Windows, use the tray menu or `Ctrl + Alt + Shift + M` to enter Mini Player from both Normal and Sidebar views. Confirm its buttons track playback, thumbs-up only enables for eligible Local Radio, clicking the track text switches its display, only the far-left grip moves it horizontally while it stays on the top edge, and toggling it off returns to the view it started from.

## User communication

Andrew prefers direct, informal explanations. Always state what changed, what passed, the version, and the direct GitHub commit. Do not overexplain internal machinery unless he asks.
