# WaveDeck

WaveDeck is a lightweight, portable internet-radio player for 64-bit Windows, Linux Mint Cinnamon, and macOS. Windows and macOS run as normal desktop windows; Linux Mint can optionally dock WaveDeck to the right edge in Sidebar Mode.

![WaveDeck logo](assets/logo.png)

## Features

- One portable ZIP containing the Windows EXE and Linux AppImage in a shared `WaveDeck Portable` folder, plus a separate universal macOS ZIP
- Single-file station-library import/export with Add New and confirmed Replace modes
- Optional silent startup updates that add new master-library stations and apply stream corrections without deleting local entries
- Optional importable copy of the complete default library for existing users
- Personal Favorites and Presets stored separately from the shareable station library
- Linux Mint Cinnamon Sidebar Mode (Linux only)
- Toggleable Presets with drag-and-drop ordering and media-key navigation
- Independent Favorites and pre-roll markers
- Native media-key controls with periodic registration checks
- Toggleable ten-station Most Played listening statistics
- Toggleable station search across names, groups, subgroups, countries, descriptions, and URLs
- Groups and optional subgroups
- Shift-click station editing and Ctrl+Shift-click pre-roll marking
- Country, description, and best-effort bitrate information
- Collapsed station groups with Expand All / Collapse All
- Collapsible, persistent sidebar notepad (Linux Sidebar Mode)
- Linux Applications-menu and panel-launcher integration (Linux only)

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

When running from source, WaveDeck stores its user data under `~/.config/wavedeck` on Linux and `Data` in the project folder on Windows and macOS.

## Build the portable Windows EXE

Place the generic 64-bit `mpv.exe` described in [`playback/win32/README.txt`](playback/win32/README.txt) at `playback/win32/mpv.exe`, then run:

```bash
npm install
npm test
npm run dist:windows
```

The portable executable is written to `dist/windows/WaveDeck.exe`. On first launch it creates `Data` beside the EXE. Windows Sidebar Mode and Linux launcher controls are intentionally hidden.

## Build the portable AppImage

```bash
npm install
npm test
npm run dist:linux
```

The AppImage is written to `dist/`. Release builds use the stable filename `WaveDeck.AppImage`. Keep future replacements at the same path so an Applications-menu or panel shortcut continues to work.

## Build the universal macOS app

The GitHub Actions macOS workflow downloads the pinned Intel and Apple Silicon
mpv builds, builds a universal application, ad-hoc signs the complete bundle,
and packages it with first-launch instructions. To build it on a Mac after
placing those mpv bundles under `playback/darwin/`, run:

```bash
npm install
npm test
npm run dist:macos
```

The resulting `WaveDeck.app` supports both Intel and Apple Silicon. Sidebar
Mode, its notepad, and Linux panel tools are intentionally hidden on macOS.

For a portable release, WaveDeck stores user data in a `Data` folder beside the executable or application bundle. The Windows EXE, Linux AppImage, and macOS app can share `library.json` and `preferences.json`; Electron's temporary runtime state and Linux playback-control socket stay on the local computer so WaveDeck can launch and play from common USB filesystems. The `Data` folder is intentionally excluded from this repository because it can contain personal preferences, listening history, and notes.

WaveDeck checks `https://fabulon.cloud/downloads/library_update.json` quietly at startup unless **Download new stations** is disabled on the Stations tab in Settings. A newer timestamp can add stations, groups, and subgroups and correct existing URLs, countries, and descriptions. It never removes a local listing, restores a station the user deleted, or changes Favorites and Presets. **Export Library** creates `WaveDeck_Library.json` with the required timestamp automatically, so an exported catalog can also be used as the master update file.

## Platform notes

The normal player, station library, Presets, Favorites, Most Played, groups, metadata, Settings, media keys, and library updates are shared across Windows, Linux, and macOS. Sidebar reservation, its notepad, and panel-launcher integration remain Linux Mint Cinnamon features.

## Project history

Detailed version notes and implementation information are available in [README-SOURCE.txt](README-SOURCE.txt).

## License

WaveDeck is licensed under the MIT License. See [LICENSE](LICENSE).
