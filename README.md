# WaveDeck

WaveDeck is a lightweight, portable internet-radio player for Linux, Windows, and macOS. Windows and macOS run as normal desktop windows; Linux Mint can optionally dock WaveDeck to the right edge in Sidebar Mode.

![WaveDeck logo](assets/logo.png)

## Features

- Portable Windows, Linux, and macOS builds that can share one adjacent `Data` folder
- Single-file station-library import/export with Add New and confirmed Replace modes
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

- 64-bit Windows 10/11, 64-bit Linux, or macOS 14+ on Intel or Apple Silicon
- Linux Mint Cinnamon on X11 for Sidebar Mode
- `mpv` installed on Linux; the Windows and macOS packages bundle mpv
- Node.js and npm when building from source

## Run from source

```bash
npm install
npm start
```

When running from source, WaveDeck stores its user data under `~/.config/wavedeck` on Linux and macOS, and `Data` in the project folder on Windows.

## Build the portable Windows EXE

Place the generic 64-bit `mpv.exe` described in [`playback/win32/README.txt`](playback/win32/README.txt) at `playback/win32/mpv.exe`, then run:

```bash
npm install
npm test
npm run dist:windows
```

The portable executable is written to `dist/windows/WaveDeck.exe`. On first launch it creates `Data` beside the EXE. Windows Sidebar Mode and Linux launcher controls are intentionally hidden.

## Build the universal macOS app

Prepare the pinned Intel and Apple Silicon mpv bundles under `playback/darwin`, then run:

```bash
npm install
npm test
npm run dist:macos
```

The universal application is written to `dist/macos/mac-universal/WaveDeck.app`. The release workflow bundles and ad-hoc signs it automatically. It uses `Data` beside the app and intentionally omits Linux Sidebar Mode.

## Build the portable AppImage

```bash
npm install
npm test
npm run dist:linux
```

The AppImage is written to `dist/`. Release builds use the stable filename `WaveDeck.AppImage`. Keep future replacements at the same path so an Applications-menu or panel shortcut continues to work.

For a portable release, WaveDeck stores user data in a `Data` folder beside the application. The Windows EXE, Linux AppImage, and macOS app share `library.json` and `preferences.json`; Electron's temporary runtime state and playback-control socket stay on the local computer so WaveDeck can launch and play from common USB filesystems. The `Data` folder is intentionally excluded from this repository because it can contain personal preferences, listening history, and notes.

## Platform notes

The normal player, station library, Presets, Favorites, Most Played, groups, metadata, and Settings are shared across Linux, Windows, and macOS. Sidebar reservation, its notepad, and panel-launcher integration remain Linux Mint Cinnamon features.

## Project history

Detailed version notes and implementation information are available in [README-SOURCE.txt](README-SOURCE.txt).

## License

WaveDeck is licensed under the MIT License. See [LICENSE](LICENSE).
