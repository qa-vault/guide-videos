// The whole pipeline, real parts only: the bundled scenario and its narration cache →
// record.mjs (Chromium against the mock app) → build.sh (ffmpeg) → mp4 + vtt + json.
// ElevenLabs is the only seam: it is never reached because the cache is complete, and the
// test proves that by running without an API key. The mock app takes a free port and the
// recorder is pointed at it (headless) through GUIDES_CONFIG, so nothing on the machine is touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cfg = loadConfig();
const example = path.join(root, "examples", "invite-teammate");
const id = "__integration-invite-teammate__";
const guide = path.join(root, cfg.dirs.videos, id);
let env;
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, env, encoding: "utf8" });
const probe = (file) => {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "stream=index,codec_type,codec_name,width,height,r_frame_rate,color_transfer:format=duration", "-of", "json", file]);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};

let server;
beforeAll(async () => {
  server = spawn(process.execPath, [path.join(example, "app", "serve.mjs")], { cwd: root, stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, PORT: "0" } });
  const banner = await new Promise((resolve, reject) => { server.stdout.once("data", (d) => resolve(String(d))); server.once("exit", reject); });
  const baseUrl = banner.match(/(http:\/\/localhost:\d+)/)[1];
  env = { ...process.env, ELEVENLABS_API_KEY: "", GUIDES_CONFIG: JSON.stringify({ baseUrl, headless: true, storageState: "" }) };
  rmSync(guide, { recursive: true, force: true });
  mkdirSync(guide, { recursive: true });
  cpSync(path.join(example, "scenario.mjs"), path.join(guide, "scenario.mjs"));
  cpSync(path.join(example, "narration"), path.join(guide, "narration"), { recursive: true });
});
afterAll(() => { server?.kill(); rmSync(guide, { recursive: true, force: true }); });

describe("record → build", () => {
  it("produces an mp4 with picture, narration and subtitles that agree with the recording", () => {
    const rec = run(process.execPath, ["record.mjs", id]);
    expect(rec.status, rec.stderr).toBe(0);
    const recording = JSON.parse(readFileSync(path.join(guide, "capture", "recording.json"), "utf8"));

    const build = run("bash", ["build.sh", id]);

    expect(build.status, build.stderr).toBe(0);
    const mp4 = path.join(guide, `${id}.mp4`);
    const { streams, format } = probe(mp4);
    const video = streams.find((s) => s.codec_type === "video");
    expect(video).toMatchObject({ codec_name: "h264", width: cfg.viewport.width * cfg.scale, height: cfg.viewport.height * cfg.scale, r_frame_rate: `${cfg.fps}/1`, color_transfer: "iec61966-2-1" });
    expect(streams.filter((s) => s.codec_type === "audio")).toHaveLength(1);
    expect(streams.filter((s) => s.codec_type === "subtitle")).toHaveLength(1);
    expect(Math.abs(Number(format.duration) * 1000 - recording.durationMs)).toBeLessThan(500);
    // sidecars next to the mp4 mirror the recording
    const vtt = readFileSync(path.join(guide, `${id}.vtt`), "utf8");
    expect(vtt.match(/-->/g)).toHaveLength(recording.cues.length);
    expect(JSON.parse(readFileSync(path.join(guide, `${id}.json`), "utf8")).chapters).toHaveLength(3);
    // every narration line was served from the cache, none synthesised
    expect(recording.cues.filter((c) => c.voice)).toHaveLength(9);
    expect(recording.pointer.clicks.length).toBeGreaterThan(0);
  });

  it("refuses to record before opening a browser when a narration line is not synthesised", () => {
    const bare = path.join(root, cfg.dirs.videos, `${id}-no-narration`);
    rmSync(bare, { recursive: true, force: true });
    mkdirSync(bare, { recursive: true });
    cpSync(path.join(example, "scenario.mjs"), path.join(bare, "scenario.mjs"));

    const rec = run(process.execPath, ["record.mjs", `${id}-no-narration`]);

    expect(rec.status).toBe(2);
    expect(rec.stderr).toContain("not synthesised yet");
    expect(existsSync(path.join(bare, "capture"))).toBe(false);
    rmSync(bare, { recursive: true, force: true });
  });

  it("refuses to build a guide that was never recorded", () => {
    const empty = path.join(root, cfg.dirs.videos, `${id}-empty`);
    rmSync(empty, { recursive: true, force: true });
    mkdirSync(empty, { recursive: true });
    writeFileSync(path.join(empty, "scenario.mjs"), "export default {};");

    const build = run("bash", ["build.sh", `${id}-empty`]);

    expect(build.status).not.toBe(0);
    expect(build.stderr).toContain("no recording");
    rmSync(empty, { recursive: true, force: true });
  });
});
