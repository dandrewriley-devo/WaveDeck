WaveDeck portable Windows, Linux, and macOS source package
Linux version 0.6.5

WaveDeck is a portable internet-radio player for Linux, Windows, and macOS.
Linux Mint Cinnamon can additionally use the sidebar toggle, which asks
Cinnamon to identify the Meta.Window's current monitor, read its work area,
move and size the Meta.Window, and create a matching built-in strut as one
desktop-side operation. There is no Electron-coordinate or X11-strut fallback;
a Cinnamon error is shown in the player instead of silently applying a partial
dock. The Linux build can start normally or automatically enter Sidebar Mode,
according to the portable preference selected in Settings.

Version 0.1.4 leaves Electron's height resizable while Sidebar Mode is active
and uses a Cinnamon-side geometry retry plus a lightweight periodic check to
keep the Meta.Window matched to the reserved full-height rectangle.

Version 0.1.5 derives the dock width from Meta.Window.get_frame_rect() instead
of reusing Electron's nominal width. This prevents a scaling mismatch from
placing a narrower real window beside part of its own reserved strip.

Version 0.1.6 completes and verifies every Cinnamon window move before creating
the reserved strip. The liveness watcher no longer moves or resizes the window
after the strip exists, preventing Cinnamon from constraining WaveDeck to the
work area immediately beside its own reservation.

Version 0.1.7 replaces the normal BrowserWindow with an Electron Linux
type="dock" BrowserWindow while Sidebar Mode is active. Cinnamon verifies the
replacement is Meta.WindowType.DOCK before it creates the reserved strip. The
dock window can therefore occupy that strip instead of being constrained into
the remaining work area. Toggling Sidebar Mode off recreates the normal window.

Version 0.1.8 adds Linux MPRIS media-key support. Play/Pause stops and reconnects
the current live station, while Previous and Next immediately move through the
alphabetically displayed favorites and wrap at either end. If no station has
been selected yet, Play starts the first favorite.

Version 0.1.9 restores the WaveDeck name throughout the product. The normal
player opens at the bottom-right of the primary screen while Settings opens
centered. Sidebar Mode adds an automatically saved plain-text notepad that is
collapsed by default and occupies 20 percent of the sidebar height when open.
The footer controls are slightly larger. Existing portable data is copied from
the previous WaveDeckSB-Data location when found, without deleting the original.

Version 0.1.10 adds a safe Linux application-launcher manager to Settings. It
registers the current portable AppImage and WaveDeck icon in the user's local
Applications menu, making Linux Mint's normal "Add to panel" command available.
WaveDeck updates or removes only launcher files carrying its management marker
and will not overwrite an existing custom wavedeck.desktop file.

Version 0.1.11 gives every Linux release the stable executable filename
WaveDeck.AppImage while retaining the version number on the downloadable ZIP.
Replacing the AppImage in place during future updates now preserves the exact
path stored by the Applications-menu and Linux Mint panel launcher.

Version 0.1.12 adds persistent drag-and-drop ordering within the Favorites
section. Each favorite stores a numeric favoriteOrder in stations.json, so the
order remains portable and is preserved by station export/import. Existing
libraries fall back to alphabetical order until rearranged, newly favorited
stations are appended, and MPRIS Previous/Next follows the custom order.

Version 0.1.13 registers directly with Cinnamon's documented
org.gnome.SettingsDaemon.MediaKeys D-Bus service in addition to retaining
MPRIS. This gives Linux Mint's Play/Pause, Previous, and Next keys a direct path
to WaveDeck, reclaims that path when a WaveDeck window receives focus, and
deduplicates a command if Cinnamon and MPRIS report the same keypress. It also
preserves null favoriteOrder values correctly for untouched libraries.

Version 0.1.14 restores the exact direct MPRIS command path used by version
0.1.11 and simplifies the Cinnamon integration. Cinnamon signals now call the
MediaController directly, registration is attempted on every Linux desktop
instead of depending on environment-name detection, each process uses a fresh
registration name, and the keys are reclaimed after station selection as well
as window focus. Cinnamon itself chooses either a registered listener or MPRIS,
so the removed cross-route deduplication layer was unnecessary.

Version 0.1.15 makes the station editor open inline directly beneath the
selected station. Right-clicking a station in the player now offers Edit
Station and opens the centered Settings window at that exact row. WaveDeck
also records qualified listening sessions by stable station ID in the portable
Data folder. After 30 seconds of continuous successful playback the
session is counted; Sidebar Mode shows the five most-listened stations above
Favorites once they reach five minutes. Settings displays every station's
total and includes a Reset Listening History command.

Version 0.2.0 replaces right-click editing with Shift-click editing and adds a
normal-click station detail panel with country, optional description, and
best-effort bitrate detection from mpv stream metadata and audio-track data.
Stations can be marked No pre-roll, which changes their star to WaveDeck lime
green. Optional subgroups can be created, renamed, reordered, deleted, and
assigned per station without changing the main group. The Sidebar-only history
section is now named Most Played, and the player footer subtly shows the app
version. The portable listening-history and subgroup files are retained during
legacy data migration.

Version 0.2.1 selects and attributes playback by stable station ID instead of
looking up the first station with a matching URL. This fixes listening totals
when duplicate or aliased station entries share one stream. Listening sessions
also tolerate brief playback-status flickers before being closed.

Version 0.2.2 drives listening sessions from WaveDeck's active station/play
state instead of depending on one mpv property-change notification. A 10-second
mpv heartbeat repairs missed playback notifications, while explicit playback
errors, pauses, stops, and station changes end or switch the tracked session.
The expanded station detail rows also use tighter vertical spacing.

Version 0.2.3 separates Presets from Favorites. Existing Favorites are migrated
to Presets with their custom order intact. Ctrl-click toggles Preset membership,
Alt-click toggles the Has pre-roll warning, Shift-click edits, and clicking the
star toggles the independent Favorite marker. Star shape now shows Favorite
status while color shows Preset, ordinary, or pre-roll status. Preset stations
remain visible in their normal group listings. All groups and subgroups start
collapsed, with an Expand All / Collapse All command beside STATIONS. Media keys
continue to navigate the ordered Presets list.

Version 0.2.4 restores the intact WaveDeck header artwork, prevents browser-style
text selection during modified station clicks, and replaces Cinnamon-conflicted
Alt-click pre-roll marking with Ctrl+Shift-click. Portable ZIP releases again
extract into the stable WaveDeck Portable Linux folder so an update merges into
the existing location while leaving Data in place.

Version 0.2.5 adds independent footer toggles for Presets and Most Played.
Presets is visible and Most Played is hidden on each fresh launch; both choices
remain in effect when switching window modes during the running session. Most
Played is available in either window mode and lists up to ten qualifying
stations. WaveDeck now opens with "Warming up the airwaves..." and keeps
non-fatal media-key integration diagnostics out of the player status line.
Listening-time updates patch only their displayed totals in Settings instead
of rebuilding the station table and interrupting an open editor. While running,
WaveDeck also reclaims Cinnamon's media keys every 15 seconds and reconnects to
the Cinnamon media-key service if that direct integration was interrupted.

Version 0.3.0 introduces the first current portable Windows build. The shared
player and Settings features remain intact, while Cinnamon Sidebar Mode, its
notepad button, and the Linux panel-shortcut tab are hidden on Windows. Windows
uses Electron's native global media-key registrations for Play/Pause, Previous,
Next, and Stop and retries missing registrations every 15 seconds. The portable
EXE bundles a generic x86-64 mpv playback engine and keeps its Data directory
beside the outer portable executable rather than electron-builder's temporary
unpack directory.

Version 0.4.0 standardizes portable storage as Data on Linux and Windows so the
two executables can share one USB-based collection. library.json now combines
stations, groups, subgroups, ordering, and assignments. Personal Favorites and
Presets live in a separately generated preferences.json that exports and library
imports never overwrite. Import offers Add New and confirmed Replace modes.
Settings keeps its header and station column headings visible while scrolling,
and the Add Station form opens directly below the station toolbar. Linux media
key registration is now single-flight and pauses during Sidebar Mode window
replacement, preventing the D-Bus write-after-end race seen when leaving the
sidebar. Platform runtime data is isolated below Data/runtime/<platform>.

Version 0.4.1 moves Electron's temporary runtime, cache, and SingletonLock files
from the USB Data folder to each computer's local application-data directory.
This fixes launches from removable filesystems that do not support Chromium's
Linux lock-file symlink. The release is now one ZIP extracting into WaveDeck
Portable with both WaveDeck.AppImage and WaveDeck.exe sharing the adjacent Data
folder. The bundled default library contains 360 stations, 17 groups, and 105
subgroups. Seven starter Presets are generated only for a genuinely new user;
existing library and preferences files remain untouched.

Version 0.4.2 moves Linux mpv's temporary Unix control socket out of the shared
USB Data folder and into WaveDeck's computer-local runtime directory. This lets
the playback engine start when WaveDeck Portable is stored on exFAT, FAT, and
other removable filesystems that cannot host Unix sockets. The library,
preferences, listening history, and notes remain shared beside both executables.

Version 0.4.3 adds a magnifying-glass footer toggle for station search. Search
starts hidden, opens at the top of the list stack, and matches names, groups,
subgroups, countries, descriptions, and stream URLs. Matching station groups
open automatically without changing the user's normal collapsed-group layout.
The visible list order is now Search, Presets, Most Played, then Stations.

Version 0.5.0 adds optional, silent master-library updates from
https://fabulon.cloud/downloads/library_update.json. The startup check is on by
default and can be disabled with Download new stations on the Settings Stations
tab. A newer timestamp adds stations, groups, and subgroups and can correct an
existing station's URL, country, and description. It never removes local
stations, restores a station the user explicitly deleted, or alters personal
Favorites and Presets. Export Library now creates WaveDeck_Library.json with the
required UTC update timestamp automatically, making the same export suitable
for sharing or publishing as the master file.

Version 0.5.1 adds an independent HTTPS fallback for the master-library check.
This fixes Linux systems where Electron's network service cannot retrieve the
update even though the same URL is reachable normally. The check remains silent
when both network methods fail.

Version 0.6.0 adds a separate universal macOS application package for Apple
Silicon and Intel Macs. It keeps the normal player, library, search, Presets,
Favorites, Most Played, Settings, media keys, and silent library updates while
leaving the Cinnamon-only Sidebar Mode, notepad, and panel tools on Linux. The
Mac app uses the same adjacent Data folder as the Windows and Linux editions,
bundles architecture-specific mpv engines, and includes first-launch
instructions in its ZIP.

Version 0.6.1 restores the packaging structure of the earlier universal Mac
build that was verified on real Intel and Apple Silicon hardware. It removes
the incompatible deep ad-hoc signature, stores each mpv engine and its
libraries as ordinary architecture-specific resources instead of nested app
bundles, and creates the ZIP with explicit preservation of executable modes and
framework symlinks. The application code and shared adjacent Data behavior are
unchanged from version 0.6.0.

Linux version 0.6.0 moves the centered toolbar directly beneath the player and
keeps both it and the optional Search field outside the scrolling station list.
Its controls are Search, Presets, Favorites Only, Your Top Five, Notepad,
Sidebar Mode, and Settings; Presets now uses a bookmark icon and the redundant
toolbar version label is removed. Most Played is renamed Your Top Five and is
again limited to five stations. Settings can optionally launch WaveDeck in
Sidebar Mode, opens at a larger 1100-by-800 default, remembers its last size and
position, and safely constrains restored geometry to the available monitor.
The Stations table now fills the remaining window height with even margins, and
subgroup names use a reliable inline Rename editor instead of a browser prompt.

Linux version 0.6.5 adds live per-station gain from -12 dB to +12 dB in the
expanded station details and saves those personal adjustments separately from
the shareable station library. Active searches temporarily hide Presets and
Your Top Five so only matching station results remain. The Settings control is
again represented by a recognizable gear, and Settings > About now includes
the complete WaveDeck changelog.

Windows version 0.6.5 brings the portable EXE into parity with the Linux
player. It adds the 0.6.0 and 0.6.5 interface features plus native Windows
Sidebar Mode, automatic Sidebar startup, and the same collapsible, shared-Data
Notepad. A small bundled Win32 helper registers WaveDeck with the Windows
AppBar API, reserves the right edge of the selected monitor, honors per-monitor
display scaling, and releases the desktop reservation when Sidebar Mode or
WaveDeck closes. Linux Applications-menu and panel-shortcut management remains
Linux-only.

Build requirements:
- 64-bit Windows, Linux, or macOS
- Node.js and npm

Build command:
  npm install
  npm run dist:linux

The AppImage is written to dist/.

Windows build command:
  npm install
  npm run dist:windows

Before building Windows, place the pinned generic 64-bit mpv.exe described in
playback/win32/README.txt at playback/win32/mpv.exe and compile
native/windows/WaveDeckSidebar.c as
native/windows/bin/WaveDeckSidebar.exe. The GitHub Actions workflow performs
both steps automatically. The portable executable is written to
dist/windows/WaveDeck.exe.

macOS build command (run on macOS):
  npm install
  npm run dist:macos

Before building macOS, place each standalone Intel and Apple Silicon mpv binary
and its adjacent lib directory in playback/darwin/x64 and
playback/darwin/arm64 as performed by the macOS GitHub Actions workflow. The
universal app is written below dist/macos/.

The Linux AppImage, Windows portable executable, and macOS app all use a Data
folder beside the executable or application bundle. They can share that folder;
temporary platform runtime state is stored in the computer's local
application-data directory. When run from source, Linux uses
~/.config/wavedeck for WaveDeck's data instead.

Playback uses the mpv executable available on the Linux system. Sidebar Mode is
intended for Linux Mint Cinnamon on X11 and uses the pure-JavaScript x11 package.
Desktop media keys use Cinnamon's media-key D-Bus API plus the Linux MPRIS
interface through dbus-next.

The Windows portable executable stores its data in Data beside WaveDeck.exe.
It uses the bundled mpv.exe and Electron global shortcuts for Windows media
keys. Native Windows Sidebar Mode reserves the right edge of the chosen monitor
and provides the same collapsible notepad used by Linux Sidebar Mode.

The universal macOS app stores its data in Data beside WaveDeck.app. It bundles
separate Intel and Apple Silicon mpv engines and registers macOS media keys.
Sidebar Mode and its notepad are not available on macOS; Linux panel integration
remains Linux-only.
