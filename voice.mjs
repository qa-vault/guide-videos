// Narration audio for guide scenarios, generated with ElevenLabs text to speech.
// Every narration line of a guide is synthesised once into videos/<guide>/narration/
// (keyed by text, neighbours, voice and model), so re-recording costs nothing.
// Not guaranteed: the hash function behind the cache key, which occurrence a repeated text maps to in
// the Map returned by synthesiseAll (record.mjs looks every position up by its own neighbours), log format.
//
//   node voice.mjs voices              list voices available to the account
//   node voice.mjs <guide-id>          synthesise every line of the guide (dry run, no browser)
//
// Reads ELEVENLABS_API_KEY from .env next to this file (or the environment).
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = loadConfig();
let V = CONFIG.voice;
let CACHE = "";
/** Selects the voice settings (a scenario may override them) and the guide's narration folder. */
export function useVoice(settings, dir) { V = settings; CACHE = dir; }

/** ElevenLabs client; the key comes from the environment or from `envFile` (default: .env next to this file). */
export function client(envFile = path.join(here, ".env")) {
  if (!process.env.ELEVENLABS_API_KEY && existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set (put it in .env next to voice.mjs)");
  return new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
}

const key = (text, prev, next) => createHash("sha1").update([V.voiceId, V.modelId, V.speed ?? 1, prev, text, next].join("\0")).digest("hex").slice(0, 16);

/** Cached narration for a line: { file, durationMs, alignment } or null when not generated yet. */
export function lookup(text, prev = "", next = "") {
  const base = path.join(CACHE, key(text, prev, next));
  if (!existsSync(`${base}.json`) || !existsSync(`${base}.wav`)) return null;
  return { file: `${base}.wav`, ...JSON.parse(readFileSync(`${base}.json`, "utf8")) };
}

/** Wraps 16-bit mono PCM in a WAV header so ffmpeg can read it directly. */
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Synthesises one line (with its neighbours as continuity context) into the cache. */
export async function synthesise(el, text, prev = "", next = "") {
  const hit = lookup(text, prev, next);
  if (hit) return hit;
  mkdirSync(CACHE, { recursive: true });
  const rate = Number(V.outputFormat.split("_")[1]);
  const r = await el.textToSpeech.convertWithTimestamps(V.voiceId, {
    text, modelId: V.modelId, outputFormat: V.outputFormat,
    previousText: prev || undefined, nextText: next || undefined,
    voiceSettings: { stability: V.stability, similarityBoost: V.similarityBoost, speed: V.speed ?? 1 },
  });
  const pcm = Buffer.from(r.audioBase64, "base64");
  const a = r.alignment;
  const durationMs = Math.round((a?.characterEndTimesSeconds?.at(-1) ?? pcm.length / (rate * 2)) * 1000);
  const base = path.join(CACHE, key(text, prev, next));
  writeFileSync(`${base}.wav`, wav(pcm, rate));
  const meta = { text, durationMs, sampleRate: rate, voiceId: V.voiceId, modelId: V.modelId,
    alignment: a ? { characters: a.characters, start: a.characterStartTimesSeconds, end: a.characterEndTimesSeconds } : null };
  writeFileSync(`${base}.json`, JSON.stringify(meta));
  return { file: `${base}.wav`, ...meta };
}

/** Synthesises every line in order (each position with its own neighbours); returns a Map text -> narration.
 *  The ElevenLabs client is created on the first cache miss, so a fully cached guide needs no API key. */
export async function synthesiseAll(lines) {
  let el = null;
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i], prev = lines[i - 1] ?? "", next = lines[i + 1] ?? "";
    const n = lookup(text, prev, next) ?? await synthesise(el ??= client(), text, prev, next);
    if (!out.has(text)) out.set(text, n);
    console.log(`${String(n.durationMs).padStart(6)} ms  ${text}`);
  }
  return out;
}

async function listVoices() {
  const el = client();
  const r = await el.voices.search({ pageSize: 100 });
  for (const v of r.voices) {
    const l = v.labels ?? {};
    console.log(`${v.voiceId}  ${(v.name ?? "").padEnd(16)} ${[l.gender, l.age, l.accent, l.descriptive ?? l.description, l.use_case ?? l.useCase].filter(Boolean).join(", ")}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [arg] = process.argv.slice(2);
  if (!arg) { console.error("usage: node voice.mjs voices | <scenario-id>"); process.exit(2); }
  if (arg === "voices") await listVoices();
  else {
    const { collectLines, configFor, loadScenario } = await import(pathToFileURL(path.join(here, "record.mjs")).href);
    useVoice(configFor(await loadScenario(arg)).voice, path.join(here, CONFIG.dirs.videos, arg, "narration"));
    if (!V.voiceId) throw new Error("no voiceId");
    const lines = await collectLines(arg);
    console.log(`${lines.length} lines in ${arg}`);
    await synthesiseAll(lines);
  }
}
