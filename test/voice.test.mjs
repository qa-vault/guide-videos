import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { useVoice, lookup, synthesise, synthesiseAll, client } from "../voice.mjs";

// Wire shape from the SDK's published API definition (serialization/types/AudioWithTimestampsResponse):
// { audio_base64, alignment: { characters, character_start_times_seconds, character_end_times_seconds } }.
const TTS = "https://api.elevenlabs.io/v1/text-to-speech/:voiceId/with-timestamps";
const requests = [];
const pcmFor = (text) => Buffer.alloc(text.length * 200, 7); // deterministic, distinct per text length
const server = setupServer(
  http.post(TTS, async ({ request, params }) => {
    const body = await request.json();
    requests.push({ voiceId: params.voiceId, body, apiKey: request.headers.get("xi-api-key") });
    const chars = [...body.text];
    return HttpResponse.json({
      audio_base64: pcmFor(body.text).toString("base64"),
      alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05) },
    });
  }),
);

const settings = () => structuredClone({ enabled: true, voiceId: "voiceA", modelId: "modelX", outputFormat: "pcm_44100", stability: 0.5, similarityBoost: 0.75, speed: 1.1, tailMs: 150 });
let dir, el;

beforeAll(() => { server.listen({ onUnhandledRequest: "error" }); process.env.ELEVENLABS_API_KEY = "test-key"; });
afterAll(() => server.close());
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "narration-")); useVoice(settings(), dir); el = new ElevenLabsClient({ apiKey: "test-key" }); requests.length = 0; });
afterEach(() => { server.resetHandlers(); rmSync(dir, { recursive: true, force: true }); });

describe("lookup", () => {
  it("returns null for a line that was never synthesised", () => {
    expect(lookup("hello", "", "")).toBeNull();
  });

  it("treats missing neighbours as empty, the same way synthesise does", async () => {
    await synthesise(el, "solo");

    expect(lookup("solo")).toEqual(lookup("solo", "", ""));
    expect(lookup("solo")).not.toBeNull();
  });

  it("returns null when the sidecar exists but the audio file is missing", async () => {
    const n = await synthesise(el, "hello");
    unlinkSync(n.file);

    expect(lookup("hello")).toBeNull();
  });
});

describe("synthesise", () => {
  it("sends the line with its neighbours, voice, model, format and voice settings to ElevenLabs", async () => {
    await synthesise(el, "middle", "before", "after");

    expect(requests).toHaveLength(1);
    expect(requests[0].voiceId).toBe("voiceA");
    expect(requests[0].apiKey).toBe("test-key");
    expect(requests[0].body).toMatchObject({ text: "middle", previous_text: "before", next_text: "after", model_id: "modelX", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.1 } });
  });

  it("omits empty neighbours from the request", async () => {
    await synthesise(el, "alone");

    expect(requests[0].body.previous_text ?? undefined).toBeUndefined();
    expect(requests[0].body.next_text ?? undefined).toBeUndefined();
  });

  it("writes a playable mono 16-bit WAV of the returned PCM at the format's sample rate", async () => {
    const n = await synthesise(el, "hello");
    const wav = readFileSync(n.file);
    const pcm = pcmFor("hello");

    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16); // fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(44100); // sample rate
    expect(wav.readUInt32LE(28)).toBe(44100 * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
  });

  it("takes the duration from the last character's end time, in whole milliseconds", async () => {
    const n = await synthesise(el, "abcd"); // 4 chars × 50 ms

    expect(n.durationMs).toBe(200);
    expect(n.sampleRate).toBe(44100);
    expect(n.alignment.characters).toEqual(["a", "b", "c", "d"]);
  });

  it("falls back to the PCM length when no alignment is returned", async () => {
    server.use(http.post(TTS, () => HttpResponse.json({ audio_base64: Buffer.alloc(44100 * 2).toString("base64") }), { once: true }));

    const n = await synthesise(el, "x");

    expect(n.durationMs).toBe(1000);
    expect(n.alignment).toBeNull();
  });

  it("returns the same narration a later lookup returns, and both name the written files", async () => {
    const n = await synthesise(el, "hello", "p", "q");

    expect(lookup("hello", "p", "q")).toEqual(n);
    expect(existsSync(n.file)).toBe(true);
    expect(n).toMatchObject({ text: "hello", voiceId: "voiceA", modelId: "modelX" });
  });

  it("serves a cached line without touching the network", async () => {
    await synthesise(el, "hello", "p", "q");
    requests.length = 0;

    await synthesise(el, "hello", "p", "q");

    expect(requests).toHaveLength(0);
  });

  it("caches per voice, model, speed, text and both neighbours: changing any one of them synthesises again", async () => {
    await synthesise(el, "t", "p", "n");
    const variants = [
      () => useVoice({ ...settings(), voiceId: "voiceB" }, dir),
      () => useVoice({ ...settings(), modelId: "modelY" }, dir),
      () => useVoice({ ...settings(), speed: 1.0 }, dir),
    ];
    const calls = [["t2", "p", "n"], ["t", "p2", "n"], ["t", "p", "n2"]];

    for (const v of variants) { v(); await synthesise(el, "t", "p", "n"); }
    useVoice(settings(), dir);
    for (const c of calls) await synthesise(el, ...c);

    expect(requests).toHaveLength(1 + variants.length + calls.length);
    expect(readdirSync(dir).filter((f) => f.endsWith(".wav"))).toHaveLength(1 + variants.length + calls.length);
  });

  it("keeps the WAV framing consistent for any PCM length", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 5000 }), async (len) => {
      server.use(http.post(TTS, () => HttpResponse.json({ audio_base64: Buffer.alloc(len * 2, 1).toString("base64") }), { once: true }));
      const n = await synthesise(el, `len-${len}`);
      const wav = readFileSync(n.file);
      expect(wav.length).toBe(44 + len * 2);
      expect(wav.readUInt32LE(4)).toBe(36 + len * 2);
      expect(wav.readUInt32LE(40)).toBe(len * 2);
      expect(n.durationMs).toBe(Math.round((len * 2) / (44100 * 2) * 1000));
    }), { numRuns: 25 });
  });
});

describe("client", () => {
  const withoutKey = (fn) => { const saved = process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_API_KEY; try { return fn(); } finally { process.env.ELEVENLABS_API_KEY = saved; } };

  it("uses the key from the environment when it is set", () => {
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, "ELEVENLABS_API_KEY=from-file\n");

    client(envFile);

    expect(process.env.ELEVENLABS_API_KEY).toBe("test-key");
  });

  it("reads the key from the env file when the environment has none", () => {
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, "ELEVENLABS_API_KEY=from-file\n");

    withoutKey(() => { client(envFile); expect(process.env.ELEVENLABS_API_KEY).toBe("from-file"); });
  });

  it("refuses to start without a key anywhere, naming the env file", () => {
    withoutKey(() => expect(() => client(path.join(dir, "missing.env"))).toThrow(/ELEVENLABS_API_KEY/));
  });
});

describe("synthesiseAll", () => {
  it("synthesises every line in order with its own neighbours and returns them keyed by text", async () => {
    const out = await synthesiseAll(["one", "two", "three"]);

    expect([...out.keys()]).toEqual(["one", "two", "three"]);
    expect(requests.map((r) => r.body.text)).toEqual(["one", "two", "three"]);
    expect(requests[1].body).toMatchObject({ previous_text: "one", next_text: "three" });
    expect(out.get("two").durationMs).toBe(150);
    expect(lookup("one", "", "two")).not.toBeNull();
    expect(lookup("three", "two", "")).not.toBeNull();
  });

  it("synthesises a repeated line once per distinct neighbourhood, so every position can be looked up later", async () => {
    await synthesiseAll(["a", "same", "b", "same", "c"]);

    expect(requests.filter((r) => r.body.text === "same")).toHaveLength(2);
    expect(lookup("same", "a", "b")).not.toBeNull();
    expect(lookup("same", "b", "c")).not.toBeNull();
  });

  it("does not synthesise the same neighbourhood twice", async () => {
    await synthesiseAll(["x", "x", "x", "x"]); // neighbourhoods: (,x) (x,x) (x,x) (x,) → three distinct

    expect(requests).toHaveLength(3);
  });

  it("makes no request at all when every line is already cached", async () => {
    await synthesiseAll(["one", "two"]);
    requests.length = 0;

    const out = await synthesiseAll(["one", "two"]);

    expect(requests).toHaveLength(0);
    expect(out.get("one")).toEqual(lookup("one", "", "two"));
  });
});
