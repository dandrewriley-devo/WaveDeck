# WaveDeck

WaveDeck is a lightweight, portable internet-radio player built for Linux Mint Cinnamon. It can run as a normal desktop window or dock itself to the right edge of the current monitor in Sidebar Mode, reserving space so maximized windows do not cover it.

![WaveDeck logo](assets/logo.png)

## Features

- Portable AppImage with station data stored beside the application
- Linux Mint Cinnamon Sidebar Mode
- Presets with drag-and-drop ordering and media-key navigation
- Independent Favorites and pre-roll markers
- Keyboard media-key controls
- Most Played listening statistics
- Groups and optional subgroups
- Shift-click station editing and Ctrl+Shift-click pre-roll marking
- Country, description, and best-effort bitrate information
- Collapsed station groups with Expand All / Collapse All
- Collapsible, persistent sidebar notepad
- Linux Applications-menu and panel-launcher integration

## Requirements

- 64-bit Linux
- Linux Mint Cinnamon on X11 for Sidebar Mode
- `mpv` installed and available on the system path
- Node.js and npm when building from source

## Run from source

```bash
npm install
npm start
```

When running from source, WaveDeck stores its user data under `~/.config/wavedeck`.

## Build the portable AppImage

```bash
npm install
npm test
npm run dist:linux
```

The AppImage is written to `dist/`. Release builds use the stable filename `WaveDeck.AppImage`. Keep future replacements at the same path so an Applications-menu or panel shortcut continues to work.

For a portable release, WaveDeck stores user data in a `WaveDeck-Data` folder beside the AppImage. That runtime folder is intentionally excluded from this repository because it can contain personal stations, listening history, and notes.

## Platform notes

The current source package targets Linux. Sidebar reservation and direct media-key integration are Cinnamon-specific. Earlier portable Windows, macOS, and Android/Quest experiments are not included in this Linux source tree.

## Project history

Detailed version notes and implementation information are available in [README-SOURCE.txt](README-SOURCE.txt).

## License

WaveDeck is licensed under the MIT License. See [LICENSE](LICENSE).
