#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// This exact static x86_64 build is the recorder that works on Linux Mint.
// Keep the release URL and both hashes pinned so every AppImage contains the
// same verified binary instead of ffmpeg-static, which previously crashed.
const ARCHIVE_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-19-13-11/ffmpeg-n8.1.2-54-gc573a95381-linux64-gpl-8.1.tar.xz";
const ARCHIVE_SHA256 = "5c7ffcf37fd5e0ab99ee2a4a6a5e70219379ec5a4dee2ed39f891c3790a2cbb5";
const BINARY_SHA256 = "08e0ec21fe0d6c9118878bb9746362c2f47f377b5c8a182cb1878e7bf5706e27";
const ARCHIVE_MEMBER = "ffmpeg-n8.1.2-54-gc573a95381-linux64-gpl-8.1/bin/ffmpeg";
const projectRoot = path.resolve(__dirname, "..");
const destination = path.join(projectRoot, ".cache", "wavedeck-tools", "linux", "ffmpeg");

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
    if (fs.existsSync(destination) && sha256(destination) === BINARY_SHA256) {
      fs.chmodSync(destination, 0o755);
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
      ARCHIVE_MEMBER
    ], { encoding: "utf8" });
    if (extracted.status !== 0) {
      throw new Error(`Could not extract FFmpeg: ${String(extracted.stderr || "").trim()}`);
    }
    const extractedBinary = path.join(extractionDir, ARCHIVE_MEMBER);
    if (sha256(extractedBinary) !== BINARY_SHA256) {
      throw new Error("Extracted FFmpeg executable failed its SHA-256 check.");
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporaryDestination = `${destination}.copying-${process.pid}`;
    fs.copyFileSync(extractedBinary, temporaryDestination);
    fs.chmodSync(temporaryDestination, 0o755);
    fs.renameSync(temporaryDestination, destination);
    console.log("WaveDeck's portable FFmpeg recorder is ready.");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
