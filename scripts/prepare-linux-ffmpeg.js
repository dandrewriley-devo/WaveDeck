#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// This exact static x86_64 build is the recorder that works on Linux Mint.
// Keep the release URL and both hashes pinned so every AppImage contains the
// same verified binary instead of ffmpeg-static, which previously crashed.
const ARCHIVE_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz";
const ARCHIVE_SHA256 = "f632249a99c08789190ae1c3bc94d1b53e093039b72e93815e8ed5d2a4a61eb8";
const BINARY_SHA256 = "e5906b59bb42f4b8cd356d47042d0bc6f62c95a392f90bda8d3b69849d730f23";
const PROBE_SHA256 = "91cf4daf79e376b8e3019252a0edf0dd244adeff15bc5f4a54f6f58911eeb73f";
const ARCHIVE_ROOT = "ffmpeg-n8.1-latest-linux64-gpl-8.1/bin";
const ARCHIVE_MEMBERS = ["ffmpeg", "ffprobe"];
const projectRoot = path.resolve(__dirname, "..");
const destinationDir = path.join(projectRoot, ".cache", "wavedeck-tools", "linux");
const destination = path.join(destinationDir, "ffmpeg");
const probeDestination = path.join(destinationDir, "ffprobe");

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const input = fs.readFileSync(filePath);
  hash.update(input);
  return hash.digest("hex");
}


async function main() {
  if (process.platform !== "linux") return;
  if (process.arch !== "x64") {
    throw new Error("WaveDeck's portable recorder build currently requires 64-bit x86 Linux.");
  }

  try {
    if (fs.existsSync(destination) && fs.existsSync(probeDestination) && sha256(destination) === BINARY_SHA256 && sha256(probeDestination) === PROBE_SHA256) {
      fs.chmodSync(destination, 0o755);
      fs.chmodSync(probeDestination, 0o755);
      console.log("WaveDeck's portable FFmpeg is ready.");
      return;
    }
  } catch {}

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wavedeck-ffmpeg-"));
  const archivePath = path.join(temporaryDirectory, "ffmpeg.tar.xz");
  const extractionDir = path.join(temporaryDirectory, "extracted");
  try {
    fs.mkdirSync(extractionDir);
    console.log("Downloading WaveDeck's portable FFmpeg...");
    const downloaded = spawnSync("curl", [
      "--fail",
      "--location",
      "--retry", "3",
      "--silent",
      "--show-error",
      "--output", archivePath,
      ARCHIVE_URL
    ], { encoding: "utf8" });
    if (downloaded.status !== 0) {
      throw new Error(`Could not download FFmpeg: ${String(downloaded.stderr || "").trim()}`);
    }
    if (sha256(archivePath) !== ARCHIVE_SHA256) {
      throw new Error("Downloaded FFmpeg archive failed its SHA-256 check.");
    }
    const extracted = spawnSync("tar", [
      "--no-same-owner",
      "-xJf", archivePath,
      "-C", extractionDir,
      ...ARCHIVE_MEMBERS.map((name) => `${ARCHIVE_ROOT}/${name}`)
    ], { encoding: "utf8" });
    if (extracted.status !== 0) {
      throw new Error(`Could not extract FFmpeg: ${String(extracted.stderr || "").trim()}`);
    }
    const extractedBinary = path.join(extractionDir, ARCHIVE_ROOT, "ffmpeg");
    const extractedProbe = path.join(extractionDir, ARCHIVE_ROOT, "ffprobe");
    if (sha256(extractedBinary) !== BINARY_SHA256) {
      throw new Error("Extracted FFmpeg executable failed its SHA-256 check.");
    }
    if (sha256(extractedProbe) !== PROBE_SHA256) {
      throw new Error("Extracted FFprobe executable failed its SHA-256 check.");
    }
    fs.mkdirSync(destinationDir, { recursive: true });
    const temporaryDestination = `${destination}.copying-${process.pid}`;
    const temporaryProbeDestination = `${probeDestination}.copying-${process.pid}`;
    fs.copyFileSync(extractedBinary, temporaryDestination);
    fs.copyFileSync(extractedProbe, temporaryProbeDestination);
    fs.chmodSync(temporaryDestination, 0o755);
    fs.chmodSync(temporaryProbeDestination, 0o755);
    fs.renameSync(temporaryDestination, destination);
    fs.renameSync(temporaryProbeDestination, probeDestination);
    console.log("WaveDeck's portable FFmpeg recorder is ready.");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
