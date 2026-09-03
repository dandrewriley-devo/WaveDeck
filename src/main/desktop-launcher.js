const fs = require("fs");
const path = require("path");

const MANAGED_MARKER = "X-WaveDeck-Managed=true";

function quoteExecArgument(value) {
  const escaped = String(value)
    .replace(/%/g, "%%")
    .replace(/([`$"\\])/g, "\\$1");
  return `"${escaped}"`;
}

function getLauncherPaths(homeDir) {
  return {
    applicationsDir: path.join(homeDir, ".local", "share", "applications"),
    launcherPath: path.join(homeDir, ".local", "share", "applications", "wavedeck.desktop"),
    iconDir: path.join(homeDir, ".local", "share", "icons", "hicolor", "256x256", "apps"),
    iconPath: path.join(homeDir, ".local", "share", "icons", "hicolor", "256x256", "apps", "wavedeck.png")
  };
}

function buildDesktopEntry({ appImagePath, version }) {
  return `[Desktop Entry]
Type=Application
Name=WaveDeck
Comment=Portable sidebar internet radio player
Exec=${quoteExecArgument(appImagePath)}
Icon=wavedeck
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupWMClass=wavedeck
X-AppImage-Version=${String(version || "")}
${MANAGED_MARKER}
`;
}

function getLauncherStatus({ homeDir, appImagePath = "" }) {
  const paths = getLauncherPaths(homeDir);
  if (!fs.existsSync(paths.launcherPath)) {
    return { ...paths, installed: false, managed: false, current: false };
  }

  let contents = "";
  try {
    contents = fs.readFileSync(paths.launcherPath, "utf8");
  } catch {}
  const managed = contents.includes(MANAGED_MARKER);
  const expectedExec = appImagePath ? `Exec=${quoteExecArgument(appImagePath)}` : "";
  return {
    ...paths,
    installed: true,
    managed,
    current: managed && Boolean(expectedExec) && contents.includes(expectedExec)
  };
}

function writeFileAtomically(target, contents, mode) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", mode });
  try {
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function copyFileAtomically(source, target, mode) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(source, temporary);
  try {
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function installLauncher({ homeDir, appImagePath, iconSourcePath, version }) {
  if (!appImagePath || !fs.existsSync(appImagePath) || !fs.statSync(appImagePath).isFile()) {
    throw new Error("The current WaveDeck AppImage could not be found.");
  }
  if (!iconSourcePath || !fs.existsSync(iconSourcePath) || !fs.statSync(iconSourcePath).isFile()) {
    throw new Error("The WaveDeck icon could not be found.");
  }

  const existing = getLauncherStatus({ homeDir, appImagePath });
  if (existing.installed && !existing.managed) {
    throw new Error("A custom wavedeck.desktop launcher already exists. WaveDeck will not overwrite it.");
  }

  const paths = getLauncherPaths(homeDir);
  fs.mkdirSync(paths.applicationsDir, { recursive: true });
  fs.mkdirSync(paths.iconDir, { recursive: true });
  copyFileAtomically(iconSourcePath, paths.iconPath, 0o644);
  writeFileAtomically(
    paths.launcherPath,
    buildDesktopEntry({ appImagePath, version }),
    0o755
  );
  return getLauncherStatus({ homeDir, appImagePath });
}

function removeLauncher({ homeDir, appImagePath = "" }) {
  const status = getLauncherStatus({ homeDir, appImagePath });
  if (!status.installed) return status;
  if (!status.managed) {
    throw new Error("The existing wavedeck.desktop file was not created by WaveDeck and was left untouched.");
  }

  fs.unlinkSync(status.launcherPath);
  try { fs.unlinkSync(status.iconPath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return getLauncherStatus({ homeDir, appImagePath });
}

module.exports = {
  MANAGED_MARKER,
  buildDesktopEntry,
  getLauncherPaths,
  getLauncherStatus,
  installLauncher,
  quoteExecArgument,
  removeLauncher
};
