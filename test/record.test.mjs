import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fc from "fast-check";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.mjs";
import { configFor, loadScenario, collectLines, ts, vtt, ffmeta } from "../record.mjs";

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
      await g.moveTo(1, 2, 100);
      await g.sleep(5);
    } },
    { title: "Two", run: async ({ g }) => { await g.click(null, "Click B"); await g.type("x", { label: "Type x" }); } },
  ],
};`);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("collects the intro text, every labelled helper call in run order, then the outro text", async () => {
    expect(await collectLines(id)).toEqual(["Intro line", "Click A", "Press Enter", "Look here", "Click B", "Type x", "Outro line"]);
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
