#!/usr/bin/env node
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "@ffprobe-installer/ffprobe";

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/with-ffmpeg.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  env: {
    ...process.env,
    HYPERFRAMES_FFMPEG_PATH: ffmpegPath,
    HYPERFRAMES_FFPROBE_PATH: ffprobe.path,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
