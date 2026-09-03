const fs = require("fs");
const path = require("path");

const PORTABLE_USER_FILES = [
  "stations.json",
  "groups.json",
  "subgroups.json",
  "listening-history.json",
  "notepad.txt"
];

function containsUserData(directory) {
  if (!directory || !fs.existsSync(directory)) return false;
  return PORTABLE_USER_FILES.some((fileName) => fs.existsSync(path.join(directory, fileName)));
}

function copyTreeWithoutOverwrite(source, destination, copied) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyTreeWithoutOverwrite(sourcePath, destinationPath, copied);
    } else if (entry.isFile() && !fs.existsSync(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
      copied.push(destinationPath);
    }
  }
}

function copyLegacyData({ legacyDirs, targetDir }) {
  const normalizedTarget = path.resolve(targetDir);
  const candidates = [...new Set((legacyDirs || [])
    .filter(Boolean)
    .map((directory) => path.resolve(directory)))]
    .filter((directory) => directory !== normalizedTarget);
  const sourceDir = candidates.find(containsUserData);
  if (!sourceDir) return { copied: [], sourceDir: null, targetDir: normalizedTarget };

  fs.mkdirSync(normalizedTarget, { recursive: true });
  const copied = [];
  for (const fileName of PORTABLE_USER_FILES) {
    const sourcePath = path.join(sourceDir, fileName);
    const destinationPath = path.join(normalizedTarget, fileName);
    if (fs.existsSync(sourcePath) && !fs.existsSync(destinationPath)) {
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
      copied.push(destinationPath);
    }
  }
  copyTreeWithoutOverwrite(
    path.join(sourceDir, "backups"),
    path.join(normalizedTarget, "backups"),
    copied
  );

  return { copied, sourceDir, targetDir: normalizedTarget };
}

module.exports = { PORTABLE_USER_FILES, containsUserData, copyLegacyData };
