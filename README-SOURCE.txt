WaveDeck portable Windows and Linux source package
Version 0.3.0

WaveDeck is a portable Linux Mint internet-radio player. The sidebar toggle asks
Cinnamon to identify the Meta.Window's current monitor, read its work area,
move and size the Meta.Window, and create a matching built-in strut as one
desktop-side operation. There is no Electron-coordinate or X11-strut fallback;
a Cinnamon error is shown in the player instead of silently applying a partial
dock. The app always starts in normal mode.

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
WaveDeck-Data folder. After 30 seconds of continuous successful playback the
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
the existing location while leaving WaveDeck-Data in place.

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

Build requirements:
- 64-bit Windows or Linux
- Node.js and npm

Build command:
  npm install
  npm run dist:linux

The AppImage is written to dist/.

Windows build command:
  npm install
  npm run dist:windows

Before building Windows, place the pinned generic 64-bit mpv.exe described in
playback/win32/README.txt at playback/win32/mpv.exe. The portable executable is
written to dist/windows/WaveDeck.exe.

The Linux AppImage stores portable data in a WaveDeck-Data folder beside the
AppImage. When run from source, WaveDeck uses ~/.config/wavedeck instead.

Playback uses the mpv executable available on the Linux system. Sidebar Mode is
intended for Linux Mint Cinnamon on X11 and uses the pure-JavaScript x11 package.
Desktop media keys use Cinnamon's media-key D-Bus API plus the Linux MPRIS
interface through dbus-next.

The Windows portable executable stores its data in Data beside WaveDeck.exe.
It uses the bundled mpv.exe and Electron global shortcuts for Windows media
keys. Sidebar Mode remains Linux-only.
