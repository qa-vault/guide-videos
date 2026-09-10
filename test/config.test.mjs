import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { merge, loadConfig } from "../config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = () => structuredClone({ baseUrl: "http://a", fps: 60, theme: { accent: "#111", text: "#222" }, voice: { speed: 1.1, voiceId: "" } });

describe("merge", () => {
  it("replaces scalars from the override and keeps the others", () => {
    const b = base();

    const out = merge(b, { fps: 30 });

    expect(out.fps).toBe(30);
    expect(out.baseUrl).toBe("http://a");
  });

  it("merges nested objects key by key", () => {
    const b = base();

    const out = merge(b, { theme: { accent: "#f00" } });

    expect(out.theme).toMatchObject({ accent: "#f00", text: "#222" });
  });

  it("replaces arrays and null values instead of merging them", () => {
    const b = { list: [1, 2], voice: { speed: 1 } };

    const out = merge(b, { list: [3], voice: null });

    expect(out.list).toEqual([3]);
    expect(out.voice).toBeNull();
  });

  it("adds keys that only the override has", () => {
    const out = merge(base(), { extra: { deep: true } });

    expect(out.extra).toEqual({ deep: true });
  });

  it("returns the base unchanged when the override is empty or missing", () => {
    const b = base();

    expect(merge(b, {})).toEqual(b);
    expect(merge(b, undefined)).toEqual(b);
  });

  it("never mutates the base object", () => {
    const b = base();
    const snapshot = structuredClone(b);

    merge(b, { fps: 1, theme: { accent: "#000" } });

    expect(b).toEqual(snapshot);
  });

  it("holds for any nested object: override keys win, untouched keys survive", () => {
    const key = fc.string({ minLength: 1 }).filter((k) => k !== "__proto__"); // a "__proto__" key is not a supported config key
    const plain = fc.dictionary(key, fc.oneof(fc.integer(), fc.string(), fc.boolean()), { maxKeys: 5 });
    const nested = fc.dictionary(key, fc.oneof(fc.integer(), fc.string(), plain), { maxKeys: 5 });

    fc.assert(
      fc.property(nested, nested, (b, o) => {
        const out = merge(b, o);
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object" && b[k] && typeof b[k] === "object") {
            for (const [kk, vv] of Object.entries(v)) expect(out[k][kk]).toEqual(vv);
            for (const kk of Object.keys(b[k])) if (!(kk in v)) expect(out[k][kk]).toEqual(b[k][kk]);
          } else expect(out[k]).toEqual(v);
        }
        for (const k of Object.keys(b)) if (!(k in o)) expect(out[k]).toEqual(b[k]);
      }),
    );
  });
});

describe("loadConfig", () => {
  it("is the tracked defaults with the local file (if any) merged over", () => {
    const defaults = JSON.parse(readFileSync(path.join(root, "guides.config.json"), "utf8"));
    let expected = defaults;
    try { expected = merge(defaults, JSON.parse(readFileSync(path.join(root, "guides.config.local.json"), "utf8"))); } catch {}

    expect(loadConfig()).toEqual(expected);
  });

  it("merges GUIDES_CONFIG from the environment last, for one-off runs", () => {
    const env = { ...process.env, GUIDES_CONFIG: JSON.stringify({ fps: 7, theme: { accent: "#123456" } }) };

    const out = JSON.parse(execFileSync(process.execPath, ["config.mjs"], { cwd: root, encoding: "utf8", env }));

    expect(out.fps).toBe(7);
    expect(out.theme).toMatchObject({ accent: "#123456", text: loadConfig().theme.text });
  });

  it("prints nothing when imported, so build.sh can capture a single value from stdout", () => {
    const out = execFileSync(process.execPath, ["-e", 'import("./config.mjs").then((m) => process.stdout.write(String(m.loadConfig().fps)))'], { cwd: root, encoding: "utf8" });

    expect(out).toMatch(/^\d+$/);
  });

  it("prints the effective configuration as JSON when run as a CLI", () => {
    const out = execFileSync(process.execPath, ["config.mjs"], { cwd: root, encoding: "utf8" });

    expect(JSON.parse(out)).toEqual(loadConfig());
  });
});
