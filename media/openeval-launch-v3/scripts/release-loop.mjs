#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "release-gate.json"), "utf8"));
const mode = process.argv[2] ?? "preflight";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function walk(dir, predicate, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, predicate, files);
    else if (predicate(path)) files.push(path);
  }
  return files;
}

function staticChecks() {
  const closingPath = join(root, config.closingComposition);
  const closing = readFileSync(closingPath, "utf8");
  const htmlFiles = walk(join(root, "compositions"), (path) => path.endsWith(".html"));

  for (const required of config.requiredClosingText) {
    if (!closing.includes(required)) fail(`${JSON.stringify(required)} is missing from ${config.closingComposition}`);
  }
  if (!process.exitCode) pass("OpenEval and the full Bootoshi acknowledgment share the configured closing composition");

  for (const needle of ["@Bootoshi", "righttointelligence.org"]) {
    const otherHits = htmlFiles.filter((path) => path !== closingPath && readFileSync(path, "utf8").includes(needle));
    if (otherHits.length) fail(`${needle} also appears in a separate composition: ${otherHits.map((p) => relative(root, p)).join(", ")}`);
  }
  if (!process.exitCode) pass("acknowledgment is not duplicated into a separate scene/card");

  const index = readFileSync(join(root, "index.html"), "utf8");
  const transitionStart = index.indexOf("// ── frame transitions");
  const transitionEnd = index.indexOf("// full-span anchor", transitionStart);
  if (transitionStart < 0 || transitionEnd < 0) {
    fail("cannot locate the injected transition block in index.html");
  } else {
    const block = index.slice(transitionStart, transitionEnd);
    const keys = [];
    for (const line of block.split("\n")) {
      const match = line.match(/tl\.(to|fromTo)\("([^"]+)".*},\s*([0-9.]+)\);\s*$/);
      if (match) keys.push(`${match[1]}|${match[2]}|${match[3]}`);
    }
    const duplicates = [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))];
    if (duplicates.length) fail(`duplicate logical transition commands: ${duplicates.join(", ")}`);
    else pass(`${keys.length} transition commands contain no duplicate selector/time operations`);
  }

  const [minimum, maximum] = config.attentionResetRangeSeconds;
  const deltas = config.attentionResets.slice(1).map((time, index) => +(time - config.attentionResets[index]).toFixed(3));
  const badDeltas = deltas.filter((delta) => delta < minimum || delta > maximum);
  if (badDeltas.length) fail(`attention-reset intervals outside ${minimum}-${maximum}s: ${badDeltas.join(", ")}`);
  else pass(`attention-reset cadence stays inside ${minimum}-${maximum}s (${deltas.join(", ")}s)`);

  const rootTag = index.match(/<div\b[^>]*\bid="root"[^>]*>/)?.[0];
  const audioTag = index.match(/<audio\b[^>]*\bid="el-bgm"[^>]*>/)?.[0];
  const rootDuration = Number(rootTag?.match(/data-duration="([0-9.]+)"/)?.[1]);
  const audioDuration = Number(audioTag?.match(/data-duration="([0-9.]+)"/)?.[1]);
  if (!Number.isFinite(rootDuration)) fail("root data-duration is missing");
  if (!Number.isFinite(audioDuration)) fail("el-bgm data-duration is missing");
  if (Number.isFinite(rootDuration) && Number.isFinite(audioDuration) && Math.abs(rootDuration - audioDuration) > 0.001) {
    fail(`root/audio duration mismatch: ${rootDuration}s vs ${audioDuration}s`);
  } else if (Number.isFinite(rootDuration) && Number.isFinite(audioDuration)) {
    pass(`root and audio durations agree at ${rootDuration}s`);
  }

  if (process.exitCode) process.exit(process.exitCode);
}

function snapshot(kind) {
  staticChecks();
  const isSeams = kind === "seams";
  const times = isSeams
    ? config.seamTimes.flatMap((time) => [+(time - 0.1).toFixed(1), +(time + 0.1).toFixed(1)])
    : config.storyReviewTimes;
  const output = join("snapshots", isSeams ? "release-gate-seams" : "release-gate-story");
  rmSync(join(root, output), { recursive: true, force: true });
  run("npx", ["--yes", `hyperframes@${config.hyperframesVersion}`, "snapshot", "--at", times.join(","), "--no-end", "--describe", "false", "-o", output]);
  pass(`${times.length} ${kind} review frames written to ${output}`);
}

function verifyRender() {
  staticChecks();
  run("npm", ["run", "check"]);

  const renderPath = join(root, config.render.path);
  if (!existsSync(renderPath)) fail(`${config.render.path} does not exist`);
  if (process.exitCode) process.exit(process.exitCode);

  const sourceFiles = [join(root, "index.html"), ...walk(join(root, "compositions"), (path) => path.endsWith(".html"))];
  const newestSource = Math.max(...sourceFiles.map((path) => statSync(path).mtimeMs));
  if (statSync(renderPath).mtimeMs < newestSource) fail(`${config.render.path} is older than the current composition source; render again`);
  else pass("render is newer than every HTML composition source");

  const probe = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels",
    "-of", "json",
    renderPath
  ], { cwd: root, encoding: "utf8" });
  if (probe.status !== 0) {
    console.error(probe.stderr);
    fail("ffprobe failed");
    process.exit(process.exitCode);
  }

  const metadata = JSON.parse(probe.stdout);
  const video = metadata.streams.find((stream) => stream.codec_type === "video");
  const audio = metadata.streams.find((stream) => stream.codec_type === "audio");
  const fpsParts = String(video?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = fpsParts[0] / fpsParts[1];
  const duration = Number(metadata.format.duration);
  const expected = config.render;

  const checks = [
    [video?.codec_name === expected.videoCodec, `video codec ${video?.codec_name}`],
    [video?.width === expected.width && video?.height === expected.height, `dimensions ${video?.width}x${video?.height}`],
    [Math.abs(fps - expected.fps) < 0.001, `frame rate ${fps}`],
    [audio?.codec_name === expected.audioCodec, `audio codec ${audio?.codec_name}`],
    [Number(audio?.sample_rate) === expected.audioSampleRate, `audio sample rate ${audio?.sample_rate}`],
    [audio?.channels === expected.audioChannels, `audio channels ${audio?.channels}`],
    [Math.abs(duration - expected.durationSeconds) <= expected.durationToleranceSeconds, `duration ${duration}s`]
  ];
  for (const [ok, label] of checks) ok ? pass(label) : fail(label);

  const digest = createHash("sha256").update(readFileSync(renderPath)).digest("hex");
  console.log(`SHA256: ${digest}`);
  console.log(`SIZE: ${metadata.format.size} bytes`);
  if (process.exitCode) process.exit(process.exitCode);
}

switch (mode) {
  case "preflight": staticChecks(); break;
  case "story": snapshot("story"); break;
  case "seams": snapshot("seams"); break;
  case "verify-render": verifyRender(); break;
  default:
    console.error("Usage: node scripts/release-loop.mjs preflight|story|seams|verify-render");
    process.exit(2);
}
