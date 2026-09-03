WAVEDECK WINDOWS PLAYBACK ENGINE

The portable Windows build bundles the generic 64-bit mpv build from shinchiro:

  Release: 20260903
  Archive: mpv-x86_64-20260903-git-69e63f425a.7z
  Archive SHA-256: 418dbfb5feb851cbed33d6c05d8481ba71802621bfd6efe8974522b28d42ac97
  mpv.exe SHA-256: 4a0bc712bc98e6f80cd980930b74b6ac202b8ccf2041e887adab69906f82731c
  Source: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260903

Place the archive's mpv.exe at playback/win32/mpv.exe before running:

  npm run dist:windows

The executable is deliberately not checked into WaveDeck's source repository.
Its GPL license and source information are included with the Windows release.
