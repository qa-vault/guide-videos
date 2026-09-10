import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compose } from "../compose.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const recording = (over = {}) => structuredClone({
  size: { width: 1440, height: 900 }, scale: 2, fps: 60,
  pointer: { hotspot: [3, 2], moves: [{ t0: 1000, t1: 1400, from: [10, 10], to: [20, 20] }], clicks: [{ t: 1400, x: 20, y: 20 }] },
  ...over,
});
const lines = (filter) => filter.trim().split(";\n");
const labels = (line) => ({ ins: [...line.matchAll(/^\[([^\]]+)\]|\]\[([^\]]+)\]/g)].map((m) => m[1] ?? m[2]), out: line.match(/\[([^\]]+)\]$/)[1] });
// Evaluates the cursor expression at time t with a tiny interpreter for the subset ffmpeg's expr uses.
const evalExpr = (expr, t) => {
  const st = [0, 0];
  const src = expr.replace(/lt\(/g, "LT(").replace(/pow\(/g, "Math.pow(")
    .replace(/st\(0,([^)]*\)[^)]*)\)/g, (_, e) => `(st[0]=(${e}))`).replace(/ld\(0\)/g, "st[0]").replace(/\bif\(/g, "IF(");
  const IF = (c, a, b) => (c ? a : b), LT = (a, b) => (a < b ? 1 : 0);
  return Function("t", "st", "IF", "LT", `return (${src});`)(t, st, IF, LT);
};
const cursorExpr = (filter, axis) => lines(filter).find((l) => l.includes("overlay@cur")).match(axis === 0 ? /x='([^']*)'/ : /y='([^']*)'/)[1];

describe("compose", () => {
  it("normalises every frame to the video size at the output frame rate before anything else", () => {
    const { filter } = compose(recording(), "/cap");

    expect(lines(filter)[0]).toMatch(/^\[0:v\]fps=60,scale=1440:900.*format=gbrp\[b\]$/);
  });

  it("defaults fps to 30 and scale to 1 when the recording has none", () => {
    const { filter } = compose(recording({ fps: undefined, scale: undefined }), "/cap");

    expect(lines(filter)[0]).toContain("fps=30,");
    expect(cursorExpr(filter, 0)).toContain(String(10 - 3)); // scale 1: px = (10 - hotspot 3) * 1
  });

  it("ends the chain with the BT.709 conversion labelled [v] in the requested range", () => {
    const tv = compose(recording(), "/cap").filter, pc = compose(recording(), "/cap", "pc").filter;

    expect(lines(tv).at(-1)).toMatch(/out_color_matrix=bt709:out_range=tv.*format=yuv420p\[v\]$/);
    expect(lines(pc).at(-1)).toContain("out_range=pc");
  });

  it("chains every filter to the next without a gap, from [0:v] to [v]", () => {
    const { filter } = compose(recording({ pointer: { hotspot: [3, 2], moves: [], clicks: [{ t: 1, x: 1, y: 1 }, { t: 2, x: 2, y: 2 }] } }), "/cap");
    const ls = lines(filter).map(labels);

    expect(ls[0].ins[0]).toBe("0:v");
    for (let i = 1; i < ls.length; i++) expect(ls[i].ins[0]).toBe(ls[i - 1].out);
    expect(ls.at(-1).out).toBe("v");
  });

  describe("without a pointer log", () => {
    it("needs no extra inputs and draws nothing", () => {
      const { filter, inputs } = compose(recording({ pointer: undefined }), "/cap");

      expect(inputs).toEqual([]);
      expect(lines(filter)).toHaveLength(2);
    });
  });

  describe("with a pointer log", () => {
    it("lists the cursor and the five ripple images under the capture dir, in input order", () => {
      const { inputs } = compose(recording(), "/cap");

      expect(inputs).toEqual(["cursor.png", "ripple0.png", "ripple1.png", "ripple2.png", "ripple3.png", "ripple4.png"].map((f) => path.join("/cap", f)));
    });

    it("overlays the cursor as input 1 and ripple k as input k+2, evaluated per frame", () => {
      const { filter } = compose(recording(), "/cap");
      const ls = lines(filter);

      expect(ls[1]).toMatch(/^\[b\]\[1:v\]overlay@cur=.*eval=frame/);
      for (let k = 0; k < 5; k++) expect(ls[2 + k]).toMatch(new RegExp(`^\\[[^\\]]+\\]\\[${k + 2}:v\\]overlay=`));
    });

    it("rests the cursor at the first move's origin before it, and at the last target after it, hotspot subtracted and scaled", () => {
      const { filter } = compose(recording(), "/cap");

      expect(evalExpr(cursorExpr(filter, 0), 0.5)).toBe((10 - 3) * 2);
      expect(evalExpr(cursorExpr(filter, 1), 0.5)).toBe((10 - 2) * 2);
      expect(evalExpr(cursorExpr(filter, 0), 2)).toBe((20 - 3) * 2);
      expect(evalExpr(cursorExpr(filter, 1), 2)).toBe((20 - 2) * 2);
    });

    it("eases the cursor inside a move: halfway in time is halfway in space, monotonic, endpoints exact", () => {
      const { filter } = compose(recording(), "/cap");
      const x = (t) => evalExpr(cursorExpr(filter, 0), t);

      expect(x(1.0)).toBe(14);
      expect(x(1.2)).toBeCloseTo(24, 6);
      expect(x(1.39999)).toBeCloseTo(34, 2);
      expect(x(1.1)).toBeGreaterThan(14);
      expect(x(1.1)).toBeLessThan(24);
    });

    it("holds the position reached between two moves", () => {
      const rec = recording({ pointer: { hotspot: [0, 0], moves: [{ t0: 0, t1: 100, from: [0, 0], to: [50, 0] }, { t0: 500, t1: 600, from: [50, 0], to: [90, 0] }], clicks: [] } });
      const { filter } = compose(rec, "/cap");

      expect(evalExpr(cursorExpr(filter, 0), 0.3)).toBe(100);
    });

    it("rests the cursor at the viewport centre when no move was logged", () => {
      const { filter } = compose(recording({ pointer: { hotspot: [3, 2], moves: [], clicks: [] } }), "/cap");

      expect(evalExpr(cursorExpr(filter, 0), 1)).toBe((720 - 3) * 2);
      expect(evalExpr(cursorExpr(filter, 1), 1)).toBe((450 - 2) * 2);
    });

    it("draws five ripple steps of 80 ms per click, centred on the click, hotspot not applied", () => {
      const { filter } = compose(recording({ pointer: { hotspot: [3, 2], moves: [], clicks: [{ t: 500, x: 30, y: 40 }] } }), "/cap");
      const ripples = lines(filter).filter((l) => /\[\d:v\]overlay=/.test(l));

      expect(ripples).toHaveLength(5);
      ripples.forEach((l, k) => {
        expect(l).toContain(`x=${(30 - 24) * 2}:y=${(40 - 24) * 2}`);
        expect(l).toContain(`enable='between(t,${(0.5 + k * 0.08).toFixed(3)},${(0.5 + (k + 1) * 0.08).toFixed(3)})'`);
      });
    });

    it("emits exactly five ripple lines per click, for any number of clicks", () => {
      fc.assert(fc.property(fc.array(fc.record({ t: fc.nat(100000), x: fc.nat(1440), y: fc.nat(900) }), { maxLength: 8 }), (clicks) => {
        const { filter } = compose(recording({ pointer: { hotspot: [3, 2], moves: [], clicks } }), "/cap");
        expect(lines(filter)).toHaveLength(2 + 1 + 5 * clicks.length);
      }));
    });

    it("keeps the cursor inside [from, to] on every axis for any move, and lands exactly on the target", () => {
      const move = fc.record({ t0: fc.nat(50000), ms: fc.integer({ min: 1, max: 5000 }), from: fc.tuple(fc.nat(1440), fc.nat(900)), to: fc.tuple(fc.nat(1440), fc.nat(900)) });
      fc.assert(fc.property(move, fc.double({ min: 0, max: 1, noNaN: true }), (m, p) => {
        const rec = recording({ scale: 1, pointer: { hotspot: [0, 0], moves: [{ t0: m.t0, t1: m.t0 + m.ms, from: m.from, to: m.to }], clicks: [] } });
        const { filter } = compose(rec, "/cap");
        for (const axis of [0, 1]) {
          const v = evalExpr(cursorExpr(filter, axis), (m.t0 + p * m.ms) / 1000);
          const lo = Math.min(m.from[axis], m.to[axis]), hi = Math.max(m.from[axis], m.to[axis]);
          expect(v).toBeGreaterThanOrEqual(lo - 1e-6);
          expect(v).toBeLessThanOrEqual(hi + 1e-6);
          expect(evalExpr(cursorExpr(filter, axis), (m.t0 + m.ms) / 1000 + 1)).toBe(m.to[axis]);
        }
      }));
    });
  });

  it("as a CLI writes filter.txt into the out dir and prints the inputs one per line, resolved next to the json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "compose-"));
    const json = path.join(dir, "recording.json");
    writeFileSync(json, JSON.stringify(recording()));

    const out = execFileSync(process.execPath, ["compose.mjs", json, dir, "tv"], { cwd: root, encoding: "utf8" });

    const { filter, inputs } = compose(recording(), dir, "tv");
    expect(readFileSync(path.join(dir, "filter.txt"), "utf8")).toBe(filter);
    expect(out.trim().split("\n")).toEqual(inputs);
  });
});
