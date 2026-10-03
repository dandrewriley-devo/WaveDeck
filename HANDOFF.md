# WaveDeck Opus Branch Handoff

## WaveDeck Opus 1.0.3

- This is the separate **`opus-portable`** branch. It is a Linux-only personal edition; `main` remains the normal cross-platform WaveDeck product.
- Release artifact: **`WaveDeckOpus.AppImage`**. Its release workflow is `.github/workflows/opus-portable.yml` and publishes tag `opus-v1.0.3` without touching the main WaveDeck release.
- WaveDeck Opus changes only the sibling portable `Music` folder. The optional Additional Music Folder is always read-only.
- Portable MP3s are indexed immediately, then converted one at a time in the background to 96 kbps Opus. Each output is validated before its MP3 source is removed. Existing valid Opus outputs and `.opus.part` recovery files are handled safely at the next pass.
- Only these tags are carried into Opus: title, artist, album, Album Artist, track number, disc number, year, genre, `RATING`, `FAVORITE`, `DO_NOT_PLAY`, and `AMP_TRACK_ID`. Embedded artwork, loose image files, lyric/sidecar files, and other metadata are intentionally discarded from the portable Music tree.
- Portable MP3 and Opus counterparts share the same logical track ID, so Local Radio station history, feedback, and Last.fm data survive conversion. Do not change `src/main/music-tags.js` identity behavior casually.
- `src/main/opus-optimizer.js` owns conversion, validation, crash recovery, source protection for the currently playing song, and portable-Music watching. It uses the bundled, pinned FFmpeg/FFprobe pair already used by Linux recording.
- 1.0.1 separates optimizer-progress IPC from real library-change IPC, preventing the Local Music tab and list from flashing during conversion. The optimizer ignores its own file-watcher events, then rescans once when a batch completes. Settings now separates Additional Music Folder from Portable Music and shows total conversion progress without a stale track name.
- 1.0.2 tightens the Local Music Settings page: Last.fm uses an inline Refresh link, stable MUSIC DATA UPDATED/UPDATING line, and no explanatory clutter or Radio Log link. Portable Music wording is shorter and clearer.
- 1.0.3 remembers Additional Music Folders per Linux computer in `Data/computer-music-folders.json`. New choices stay temporary until the user selects the inline Remember this computer link; no popup is used. Existing single-folder settings migrate to the first computer that opens this release.

# WaveDeck Project Handoff

This is the internal continuity reference for future WaveDeck work. It reflects the published development build through **1.0.5**.

## Current published state

- Repository: `dandrewriley-devo/WaveDeck`
- Branch: `main`
- Current version: **1.0.5**
- Current release: 1.0.5 — creates the visible portable `Music` folder on startup, bundles WaveDeck's read-only Last.fm access, and adds 42 built-in Local Mix format books.
- Current commit: the verified 1.0.5 release commit at the head of `main`.
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
- Persistent tuning controls: Song Repeat Wait has 1–24 hour stops (default 4); Artist Repeat Wait has 30, 60, 90, 120, and 180 minute stops (default 90); Artist Sets are Single Tracks, Two-fers, Three-way, and Four-play (default Single Tracks). Artist Sets are planned before the first song and only start when the full requested set is eligible.
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
