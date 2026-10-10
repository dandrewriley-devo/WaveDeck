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
const ARCHIVE_SHA256 = "e4fba844d3451bd9b386dd007180a3db0ac343909d7796b0600eb4845b442aab";
const BINARY_SHA256 = "e35727315569a41ca0d13726648c96ae33a040e108f1bc25de1529cd4e257ea2";
const PROBE_SHA256 = "2d06053fcdfb69bdbe844fd8ff725a9a960af83ffad21f665d81c0c666234c0b";
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
