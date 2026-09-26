# WaveDeck

WaveDeck is a lightweight, portable internet-radio player for 64-bit Windows, Linux Mint Cinnamon, and macOS. Windows and macOS run as normal desktop windows; Linux Mint can optionally dock WaveDeck to the right edge in Sidebar Mode.

![WaveDeck logo](assets/logo.png)

## Features

- One portable ZIP containing the Windows EXE and Linux AppImage in a shared `WaveDeck Portable` folder, plus a separate universal macOS ZIP
- Single-file station-library import/export with Add New and confirmed Replace modes
- Optional silent startup updates that add new master-library stations and apply stream corrections without deleting local entries
- Optional importable copy of the complete default library for existing users
- Personal Favorites and Presets stored separately from the shareable station library
- Linux Mint Cinnamon and Windows Sidebar Mode
- Optional automatic Sidebar Mode at startup on Linux and Windows
- Toggleable Presets with drag-and-drop ordering, remembered visibility, and media-key navigation
- Independent Favorites, a Favorites-only station filter, and pre-roll markers
- Native media-key controls with periodic registration checks
- Toggleable five-station Your Top Five listening statistics
- Fixed toolbar and toggleable station search across names, groups, subgroups, countries, descriptions, and URLs
- Remembered groups and optional subgroups, expanded by default
- Shift-click station editing and Ctrl+Shift-click pre-roll marking
- Country, description, and best-effort bitrate information
- Collapsed station groups with Expand All / Collapse All
- Linux Applications-menu and panel-launcher integration (Linux only)
- A larger Settings window that remembers its monitor-safe size and position on Linux and Windows
- Advanced Features local MP3 search, album playback, and continuous Artist/Song Radio

## Requirements

- 64-bit Windows 10/11, 64-bit Linux, or macOS
- macOS 14 or newer on Apple Silicon; macOS 11 or newer on Intel
- Linux Mint Cinnamon on X11 for Sidebar Mode
- `mpv` installed on Linux; the Windows and macOS packages bundle mpv
- Node.js and npm when building from source

## Run from source

```bash
npm install
npm start
```

On Linux, the first start downloads WaveDeck's pinned portable FFmpeg recorder and verifies both the archive and executable checksums. Later starts reuse it. When running from source, WaveDeck stores its user data under `~/.config/wavedeck` on Linux and `Data` in the project folder on Windows and macOS.

## Local music in Advanced Features

Enable Advanced Features in Settings, then open the Local Music tab. WaveDeck creates a
`Music` folder beside `Data` and scans every MP3 inside it, including nested folders.
It reads tags without ever modifying the music files, keeping its portable search index
and radio-session history in `Data`.

Search by song, artist, album, genre, year, composer, comments, filename, or path. An
album plays in disc/track order and then continues as Artist Radio, while Artist/Song
Radio continue indefinitely. A `DO_NOT_PLAY=1` MP3 tag is an absolute exclusion.
`FAVORITE=1` and read-only MP3 ratings are WaveDeck's strongest personal taste signals;
Last.fm track popularity fills familiarity gaps after a song has passed the Local Radio
fit rules. Song Familiarity offers Favor the Hits, Balanced Mix, and Play Deep Cuts Too.
Favor the Hits first selects from Favorites, 4–5 star songs, and familiar Last.fm tracks.
WaveDeck never automatically repeats a song within 120 minutes. It does not use album
artwork or ReplayGain.

## Build the portable Windows EXE

Place the generic 64-bit `mpv.exe` described in [`playback/win32/README.txt`](playback/win32/README.txt) at `playback/win32/mpv.exe` and compile `native/windows/WaveDeckSidebar.c` to `native/windows/bin/WaveDeckSidebar.exe`, then run:

```bash
npm install
npm test
npm run dist:windows
```

The Windows GitHub Actions workflow builds both bundled native components automatically. The portable executable is written to `dist/windows/WaveDeck.exe`. On first launch it creates `Data` beside the EXE. Windows Sidebar Mode is available; Linux Applications-menu and panel-launcher controls are intentionally omitted.

## Build the portable AppImage

```bash
npm install
npm test
npm run dist:linux
```

The build automatically downloads and checksum-verifies WaveDeck's pinned portable FFmpeg recorder before packaging. The AppImage is written to `dist/`. Release builds use the stable filename `WaveDeck.AppImage`. Keep future replacements at the same path so an Applications-menu or panel shortcut continues to work.

## Build the universal macOS app

The GitHub Actions macOS workflow downloads the pinned Intel and Apple Silicon
mpv builds, builds a universal unsigned application, and packages it with
permissions, symlinks, and first-launch instructions preserved. To build it on a Mac after
placing those mpv bundles under `playback/darwin/`, run:

```bash
npm install
npm test
npm run dist:macos
```

The resulting `WaveDeck.app` supports both Intel and Apple Silicon. Sidebar
Mode and Linux panel tools are intentionally hidden on macOS.

For a portable release, WaveDeck stores user data in a `Data` folder beside the executable or application bundle. The Windows EXE, Linux AppImage, and macOS app can share `library.json` and `preferences.json`; Electron's temporary runtime state and Linux playback-control socket stay on the local computer so WaveDeck can launch and play from common USB filesystems. The `Data` folder is intentionally excluded from this repository because it can contain personal preferences and listening history.

WaveDeck checks `https://fabulon.cloud/downloads/library_update.json` quietly at startup unless **Download new stations** is disabled on the Stations tab in Settings. A newer timestamp can add stations, groups, and subgroups and correct existing URLs, countries, and descriptions. It never removes a local listing, restores a station the user deleted, or changes Favorites and Presets. **Export Library** creates `WaveDeck_Library.json` with the required timestamp automatically, so an exported catalog can also be used as the master update file.

## Platform notes

The normal player, station library, Presets, Favorites, listening statistics, groups, metadata, Settings, media keys, and library updates are shared across Windows, Linux, and macOS. Sidebar Mode is available on Linux Mint Cinnamon and Windows. Applications-menu and panel-launcher integration remain Linux-only; Sidebar Mode is not available on macOS.

## Project history

Detailed version notes and implementation information are available in [README-SOURCE.txt](README-SOURCE.txt).

## License

WaveDeck is licensed under the MIT License. See [LICENSE](LICENSE).
