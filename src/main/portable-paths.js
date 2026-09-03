const path = require("path");

function resolvePortableState({ platform, isPackaged, appImagePath }) {
  if (!isPackaged) return false;
  if (platform === "win32") return true;
  return platform === "linux" && Boolean(appImagePath);
}

function resolveDataDir({
  envDataDir,
  platform,
  isPackaged,
  appImagePath,
  portableExecutableDir,
  execPath,
  projectRoot,
  homeDir
}) {
  const pathApi = platform === "win32" ? path.win32 : path;
  if (envDataDir) return pathApi.resolve(envDataDir);

  if (platform === "win32" && isPackaged) {
    const executableDir = portableExecutableDir || pathApi.dirname(execPath);
    return pathApi.join(pathApi.resolve(executableDir), "Data");
  }

  if (platform === "linux" && isPackaged && appImagePath) {
    return pathApi.join(pathApi.dirname(pathApi.resolve(appImagePath)), "WaveDeck-Data");
  }

  if (platform === "win32") return pathApi.join(projectRoot, "Data");
  return pathApi.join(homeDir, ".config", "wavedeck");
}

function resolveLegacyDataDirs({ platform, isPackaged, appImagePath, homeDir }) {
  const pathApi = platform === "win32" ? path.win32 : path;
  if (platform === "linux" && isPackaged && appImagePath) {
    const appDirectory = pathApi.dirname(pathApi.resolve(appImagePath));
    return [
      pathApi.join(appDirectory, "WaveDeckSB-Data"),
      pathApi.join(pathApi.dirname(appDirectory), "WaveDeckSB Portable Linux", "WaveDeckSB-Data")
    ];
  }
  if (platform === "linux") return [pathApi.join(homeDir, ".config", "wavedecksb")];
  return [];
}

module.exports = { resolveDataDir, resolveLegacyDataDirs, resolvePortableState };
