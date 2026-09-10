import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.mjs";
import { configFor, loadScenario, collectLines, ts, vtt, ffmeta, Guide } from "../record.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = loadConfig();

describe("configFor", () => {
  it("returns the base configuration for a scenario without overrides", () => {
    expect(configFor({})).toEqual(base);
    expect(configFor(undefined)).toEqual(base);
  });

  it("merges voice and timing overrides key by key and replaces fps", () => {
    const c = configFor({ overrides: { fps: 24, voice: { voiceId: "v1" }, timing: { moveMs: 10 } } });

    expect(c.fps).toBe(24);
    expect(c.voice).toEqual({ ...base.voice, voiceId: "v1" });
    expect(c.timing).toEqual({ ...base.timing, moveMs: 10 });
  });

  it("does not mutate the base configuration", () => {
    const before = structuredClone(loadConfig());

    configFor({ overrides: { voice: { voiceId: "changed" }, timing: { moveMs: 1 } } });

    expect(configFor({})).toEqual(before);
  });
});

describe("collectLines", () => {
  const id = "__contract-test__";
  const dir = path.join(root, base.dirs.videos, id);
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "scenario.mjs"), `export default {
  start: { path: "/x", ready: () => { throw new Error("ready must not run in a dry run"); } },
  intro: { eyebrow: "E", title: "T", text: "Intro line" },
  outro: { eyebrow: "E", title: "T", text: "Outro line" },
  scenes: [
    { title: "One", run: async ({ page, g }) => {
      await g.click(page.getByRole("button", { name: "A" }), "Click A");
      await page.getByRole("dialog").waitFor();
      await g.type("typed text");
      await g.key("Enter", "Press Enter");
      await g.say("Look here", 800);
      await g.say("", 100);
      await g.hush();
      await g.point([5, 5], "Point here", 10);
      await g.moveTo(1, 2, 100);
      await g.sleep(5);
    } },
    { title: "Two", run: async ({ g }) => { await g.click(null, "Click B"); await g.type("x", { label: "Type x" }); } },
  ],
};`);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("collects the intro text, every labelled helper call in run order, then the outro text", async () => {
    expect(await collectLines(id)).toEqual(["Intro line", "Click A", "Press Enter", "Look here", "Point here", "Click B", "Type x", "Outro line"]);
  });

  it("loads the scenario's default export from videos/<id>/scenario.mjs", async () => {
    const s = await loadScenario(id);

    expect(s.intro.text).toBe("Intro line");
    expect(s.scenes).toHaveLength(2);
  });

  it("fails for an unknown guide id", async () => {
    await expect(loadScenario("__no-such-guide__")).rejects.toThrow();
  });
});

describe("Guide.point", () => {
  const fakePage = () => ({ mouse: { move: async () => {} } });

  it("moves the cursor first, then speaks the whole line, then pauses, before returning", async () => {
    const voice = new Map([["Look at this", { file: "x.wav", durationMs: 300 }]]);
    const g = new Guide(fakePage(), voice);
    const started = g.now();

    await g.point([100, 200], "Look at this", 120);
    const returned = g.now();

    const [move] = g.pointer.moves;
    const [cue] = g.cues;
    expect(move.to).toEqual([100, 200]);
    expect(cue.start).toBeGreaterThanOrEqual(move.t1); // the line opens only once the cursor has arrived
    expect(g.open).toBeNull(); // the line is closed before point returns
    expect(cue.end).toBeGreaterThanOrEqual(cue.start + 300);
    expect(returned - started).toBeGreaterThanOrEqual(move.t1 - move.t0 + 300 + base.voice.tailMs + 120);
    expect(cue).toMatchObject({ text: "Look at this", voice: "x.wav" });
  });

  it("fails clearly when the locator has no box", async () => {
    const g = new Guide(fakePage(), new Map());

    await expect(g.point({ boundingBox: async () => null }, "Ghost")).rejects.toThrow(/Ghost/);
  });

  it("accepts a locator and points at the centre of its box", async () => {
    const g = new Guide(fakePage(), new Map());
    const locator = { boundingBox: async () => ({ x: 10, y: 20, width: 100, height: 50 }) };

    await g.point(locator, "Centre");

    expect(g.pointer.moves[0].to).toEqual([60, 45]);
    expect(g.cues[0].text).toBe("Centre");
  });
});

describe("Guide.say", () => {
  it("returns ms after the line starts, while the line is still playing", async () => {
    const voice = new Map([["Long line", { file: "l.wav", durationMs: 600 }]]);
    const g = new Guide({ mouse: { move: async () => {} } }, voice);
    const started = g.now();

    await g.say("Long line", 150);
    const returned = g.now();

    expect(returned - started).toBeGreaterThanOrEqual(150);
    expect(returned - started).toBeLessThan(600);
    expect(g.open).toMatchObject({ text: "Long line" });
  });

  it("returns immediately when no pause is asked for", async () => {
    const g = new Guide({ mouse: { move: async () => {} } }, new Map([["L", { file: "l.wav", durationMs: 600 }]]));
    const started = g.now();

    await g.say("L");

    expect(g.now() - started).toBeLessThan(50);
  });
});

describe("ts", () => {
  it("formats milliseconds as HH:MM:SS.mmm", () => {
    expect(ts(0)).toBe("00:00:00.000");
    expect(ts(1207)).toBe("00:00:01.207");
    expect(ts(61 * 60 * 1000 + 5999)).toBe("01:01:05.999");
  });

  it("is monotonic and fixed-width for any duration under a day", () => {
    fc.assert(fc.property(fc.nat(86_399_999), fc.nat(86_399_999), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      expect(ts(lo) <= ts(hi)).toBe(true);
      expect(ts(a)).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    }));
  });
});

describe("vtt", () => {
  it("writes a WebVTT file with one numbered cue per narration line", () => {
    const out = vtt([{ start: 1207, end: 11214, text: "First" }, { start: 11907, end: 16629, text: "Second", voice: "x.wav" }]);

    expect(out).toBe("WEBVTT\n\n1\n00:00:01.207 --> 00:00:11.214\nFirst\n\n2\n00:00:11.907 --> 00:00:16.629\nSecond\n");
  });

  it("writes just the header when there are no cues", () => {
    expect(vtt([])).toBe("WEBVTT\n\n");
  });
});

describe("ffmeta", () => {
  it("writes one chapter per mark, each ending where the next starts and the last at the end of the video", () => {
    const out = ffmeta([{ start: 5000, title: "One" }, { start: 20000, title: "Two" }], 43000);

    expect(out).toBe(";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=5000\nEND=20000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=20000\nEND=43000\ntitle=Two\n");
  });

  it("writes just the header when there are no chapters", () => {
    expect(ffmeta([], 1000)).toBe(";FFMETADATA1\n");
  });
});
