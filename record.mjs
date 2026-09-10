// Records a guide video scenario: drives the app with Playwright, draws an emulated
// cursor and chapter cards, captures 2x PNG frames and writes the narration/chapter
// sidecars. Project-agnostic: everything product-specific lives in guides.config.local.json
// and in the scenario modules under scenarios/.
//
// Usage:
//   node record.mjs <guide-id>     (guide = videos/<guide-id>/scenario.mjs)
import { chromium } from "playwright";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE_CONFIG = loadConfig();
/** Base config with a scenario's optional `overrides` ({ voice, timing, fps }) merged in. */
export function configFor(scenario) {
  const o = scenario?.overrides ?? {};
  return { ...BASE_CONFIG, ...o, voice: { ...BASE_CONFIG.voice, ...o.voice }, timing: { ...BASE_CONFIG.timing, ...o.timing } };
}
let CONFIG = BASE_CONFIG;

const SIZE = CONFIG.viewport;
const SCALE = CONFIG.scale;
const VIDEO = { width: SIZE.width * SCALE, height: SIZE.height * SCALE };
const T = CONFIG.theme;
let TIMING = CONFIG.timing;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Injected into the page: cursor, click ripple and chapter card. Colours and fonts come
// from the config so the overlay can match any product's design.
const OVERLAY = `
(() => {
  if (window.__guide) return;
  const style = document.createElement('style');
  style.textContent = \`
    #g-chapter{position:fixed;inset:0;z-index:2147483644;pointer-events:none;display:flex;align-items:center;justify-content:center;background:${T.scrim};backdrop-filter:blur(10px);opacity:0;transition:opacity .25s ease}
    #g-chapter.on{opacity:1}
    #g-chapter .card{max-width:720px;text-align:center;color:${T.text};font-family:${T.font}}
    #g-chapter .eyebrow{font:600 12px/1 ${T.monoFont};letter-spacing:.12em;text-transform:uppercase;color:${T.accentText};margin-bottom:18px}
    #g-chapter h1{font-size:40px;font-weight:600;margin:0 0 14px;letter-spacing:-.01em}
    #g-chapter p{font-size:18px;line-height:1.5;color:${T.muted};margin:0}
  \`;
  document.head.appendChild(style);
  const chap = document.createElement('div'); chap.id = 'g-chapter'; chap.innerHTML = '<div class="card"><div class="eyebrow"></div><h1></h1><p></p></div>';
  document.body.append(chap);
  window.__guide = {
    chapter: (eyebrow, title, text) => { chap.querySelector('.eyebrow').textContent = eyebrow; chap.querySelector('h1').textContent = title; chap.querySelector('p').textContent = text; chap.classList.add('on'); },
    hideChapter: () => chap.classList.remove('on'),
  };
})();`;

// Cursor and click-ripple artwork, rendered by the browser at device resolution and
// composited onto the frames at build time (see build.sh); the page never shows them.
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 30" width="22" height="30"><path d="M2 2 L2 23 L7.5 18 L11 27 L15 25.5 L11.5 17 L19 16.5 Z" fill="${T.cursorFill}" stroke="${T.cursorStroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const RIPPLE_STEPS = 5; // ring sizes 20..44 CSS px, fading out
const rippleSvg = (k) => { const d = 20 + 24 * k / (RIPPLE_STEPS - 1), o = 0.9 * (1 - k / RIPPLE_STEPS); return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="${d / 2 - 1}" fill="none" stroke="${T.accent}" stroke-width="2" opacity="${o.toFixed(2)}"/></svg>`; };
async function renderArtwork(context, dir) {
  const page = await context.newPage();
  const shot = async (svg, file) => {
    await page.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
    await page.locator("svg").screenshot({ path: file, omitBackground: true, scale: "device" });
  };
  await shot(CURSOR_SVG, path.join(dir, "cursor.png"));
  for (let k = 0; k < RIPPLE_STEPS; k++) await shot(rippleSvg(k), path.join(dir, `ripple${k}.png`));
  await page.close();
}

export const ts = (ms) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), f = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
};

/** The API scenario modules use: cursor, clicks, typing, narration cues and chapter marks. */
export class Guide {
  constructor(page, voice = new Map()) { this.page = page; this.voice = voice; this.t0 = Date.now(); this.x = SIZE.width / 2; this.y = SIZE.height / 2; this.cues = []; this.chapters = []; this.open = null; this.frames = []; this.pointer = { moves: [], clicks: [] }; }
  now() { return Date.now() - this.t0; } // t0 is reset to the first frame's timestamp by startCapture
  /** Narration audio for a line, when it was synthesised (voice.mjs). */
  narration(text) { return this.voice.get(text) ?? null; }
  /** Waits until the open cue's narration has finished speaking (plus a short tail). */
  async settle() {
    const n = this.open && this.narration(this.open.text);
    if (!n) return;
    const until = this.open.start + n.durationMs + (CONFIG.voice?.tailMs ?? 0);
    const wait = until - this.now();
    if (wait > 0) await sleep(wait);
  }
  /** Start a narration cue; the previous one ends here, after its narration has been spoken. */
  async cue(text) { await this.settle(); this.endCue(); if (text) this.open = { start: this.now(), text }; }
  endCue() {
    if (!this.open) return;
    const n = this.narration(this.open.text);
    const spoken = n ? this.open.start + n.durationMs : this.open.start + 400;
    const end = Math.max(spoken, this.now() - TIMING.cueGapMs);
    this.cues.push({ ...this.open, end, voice: n?.file ?? null });
    this.open = null;
  }
  mark(title) { this.chapters.push({ start: this.now(), title }); }
  async install() { await this.page.addInitScript(OVERLAY); await this.page.evaluate(OVERLAY); await this.page.mouse.move(this.x, this.y); }
  /** Capture device-pixel PNG frames with Page.captureScreenshot (the CDP screencast only
   *  returns CSS-size frames). `inflight` requests are pipelined; a frame's timestamp is
   *  its request time and build.sh resamples the sequence to a constant frame rate. */
  async startCapture(dir) {
    this.frames = []; this.capturing = true;
    this.cdp = await this.page.context().newCDPSession(this.page);
    const clip = { x: 0, y: 0, width: SIZE.width, height: SIZE.height, scale: SCALE };
    let i = 0;
    const one = async () => {
      const idx = i++, t = Date.now();
      const file = path.join(dir, `f${String(idx).padStart(6, "0")}.png`);
      try {
        const r = await this.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, clip, captureBeyondViewport: false });
        writeFileSync(file, Buffer.from(r.data, "base64"));
        if (this.frames.length === 0) this.t0 = t;
        this.frames.push({ file, t });
      } catch { /* page navigating: skip this frame */ }
    };
    const worker = async () => { while (this.capturing) await one(); };
    this.workers = Array.from({ length: CONFIG.inflight }, worker);
  }
  async stopCapture() { this.capturing = false; await Promise.all(this.workers ?? []); this.frames.sort((a, b) => a.t - b.t); }
  async ensure() { await this.page.evaluate(OVERLAY); }
  async card({ eyebrow, title, text }, ms) {
    await this.ensure();
    await this.cue(text);
    const n = this.narration(text);
    await this.page.evaluate(([e, t, d]) => window.__guide.chapter(e, t, d), [eyebrow, title, text]);
    await sleep(n ? Math.max(ms, n.durationMs + (CONFIG.voice?.tailMs ?? 0) + 500) : ms);
    await this.page.evaluate(() => window.__guide.hideChapter());
    this.endCue();
    await sleep(TIMING.afterCardMs);
  }
  async say(text, ms = 0) { await this.cue(text); if (ms) await sleep(ms); }
  async hush() { await this.settle(); this.endCue(); }
  /** Points at something and talks about it: moves the cursor to `target` ([x, y] or a locator),
   *  then speaks `line`, waits until it has been spoken, then `ms` more. The next call starts after that. */
  async point(target, line, ms = 0) {
    let x, y;
    if (Array.isArray(target)) [x, y] = target;
    else {
      const box = await target.boundingBox();
      if (!box) throw new Error(`no box for ${line}`);
      x = box.x + box.width / 2; y = box.y + box.height / 2;
    }
    await this.moveTo(x, y);
    await this.say(line);
    await this.hush();
    if (ms) await sleep(ms);
  }
  /** Moves the real mouse along an eased path and logs the segment; the visible cursor is
   *  drawn at build time from this log, so it is smooth whatever the capture rate. */
  async moveTo(x, y, ms = TIMING.moveMs) {
    const steps = Math.max(8, Math.round(ms / 33));
    const sx = this.x, sy = this.y, t0 = this.now();
    this.pointer.moves.push({ t0, t1: t0 + ms, from: [sx, sy], to: [x, y] });
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out
      await this.page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
      await sleep(ms / steps);
    }
    this.x = x; this.y = y;
  }
  async click(locator, label, { pause = TIMING.clickPauseMs, ms } = {}) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`no box for ${label}`);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (label) await this.say(label);
    await this.moveTo(x, y, ms);
    await sleep(pause);
    this.pointer.clicks.push({ t: this.now(), x, y });
    await this.page.mouse.down(); await sleep(70); await this.page.mouse.up();
    await sleep(TIMING.afterClickMs);
  }
  async type(text, { delay = TIMING.typeDelayMs, label } = {}) { if (label) await this.say(label); await this.page.keyboard.type(text, { delay }); await sleep(TIMING.afterTypeMs); }
  async key(key, label, after = TIMING.afterKeyMs) { if (label) await this.say(label); await this.page.keyboard.press(key); await sleep(after); }
  sleep(ms) { return sleep(ms); }
}

/** Dry-run guide: no browser, no waiting; only records the narration lines in order. */
class DryGuide extends Guide {
  constructor() { super(null); this.lines = []; }
  async cue(text) { if (text) this.lines.push(text); }
  async settle() {}
  async card({ text }) { await this.cue(text); }
  async say(text) { await this.cue(text); }
  async hush() {}
  async moveTo() {}
  async point(_t, line) { await this.cue(line); }
  async click(_l, label) { if (label) await this.cue(label); }
  async type(_t, { label } = {}) { if (label) await this.cue(label); }
  async key(_k, label) { if (label) await this.cue(label); }
  sleep() { return Promise.resolve(); }
}
// Stands in for the Playwright page during a dry run: every property and call returns itself,
// `await` on it resolves immediately.
const stubPage = new Proxy(function () {}, { get: (_, k) => (k === "then" ? undefined : stubPage), apply: () => stubPage });

export async function loadScenario(id) {
  const file = path.join(here, CONFIG.dirs.videos, id, "scenario.mjs");
  return (await import(pathToFileURL(file).href)).default;
}

/** All narration lines of a scenario in speaking order (intro, scenes, outro). */
export async function collectLines(id) {
  const scenario = await loadScenario(id);
  const g = new DryGuide();
  const ctx = { page: stubPage, g, baseUrl: CONFIG.baseUrl, sleep: () => Promise.resolve() };
  await g.card(scenario.intro);
  for (const scene of scenario.scenes) await scene.run(ctx);
  await g.card(scenario.outro);
  return g.lines;
}

export function vtt(cues) {
  return "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
}
export function ffmeta(chapters, endMs) {
  const lines = [";FFMETADATA1"];
  chapters.forEach((c, i) => {
    const end = chapters[i + 1]?.start ?? endMs;
    lines.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${c.start}`, `END=${end}`, `title=${c.title}`);
  });
  return lines.join("\n") + "\n";
}

// ---- run the scenario -------------------------------------------------------------
if (process.argv[1] !== fileURLToPath(import.meta.url)) { /* imported for collectLines */ }
else {
const [scenarioId] = process.argv.slice(2);
if (!scenarioId) { console.error("usage: node record.mjs <scenario-id>"); process.exit(2); }
const scenario = await loadScenario(scenarioId);
CONFIG = configFor(scenario); TIMING = CONFIG.timing;
const guideDir = path.join(here, CONFIG.dirs.videos, scenarioId);
// Narration: every line must be synthesised beforehand (node voice.mjs <id>) when voice is enabled.
const voice = new Map();
if (CONFIG.voice?.enabled) {
  const { lookup, useVoice } = await import("./voice.mjs");
  useVoice(CONFIG.voice, path.join(guideDir, "narration"));
  const lines = await collectLines(scenarioId);
  const missing = [];
  lines.forEach((text, i) => { const n = lookup(text, lines[i - 1] ?? "", lines[i + 1] ?? ""); if (n) voice.set(text, n); else missing.push(text); });
  if (missing.length) { console.error(`${missing.length} narration line(s) not synthesised yet — run: node voice.mjs ${scenarioId}\n  ` + missing.join("\n  ")); process.exit(2); }
}
const captureDir = path.join(guideDir, "capture");
const frameDir = path.join(captureDir, "frames");
await rm(captureDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

// A saved login is optional: an empty `storageState` records without one, a set one must exist.
const storageState = CONFIG.storageState ? path.resolve(CONFIG.storageState) : undefined;
if (storageState && !existsSync(storageState)) {
  console.error(`storageState file not found: ${storageState}\nSave one after logging in with page.context().storageState({ path }), or leave "storageState" empty in guides.config.local.json.`);
  process.exit(2);
}
const browser = await chromium.launch({ headless: CONFIG.headless, args: ["--hide-scrollbars"] });
const context = await browser.newContext({
  storageState,
  viewport: SIZE,
  deviceScaleFactor: SCALE,
  colorScheme: CONFIG.colorScheme,
});
await renderArtwork(context, captureDir);
const page = await context.newPage();
const g = new Guide(page, voice);
const ctx = { page, g, baseUrl: CONFIG.baseUrl, sleep };
let failed = null;
try {
  await page.goto(`${CONFIG.baseUrl}${scenario.start.path}`);
  await scenario.start.ready(ctx);
  await g.install();
  await g.startCapture(frameDir);
  await sleep(1200);
  await g.card(scenario.intro, TIMING.introCardMs);
  for (const scene of scenario.scenes) {
    g.mark(scene.title);
    await scene.run(ctx);
  }
  await g.hush();
  await g.card(scenario.outro, TIMING.outroCardMs);
} catch (e) { failed = e; } finally {
  g.endCue();
  await sleep(300);
  await g.stopCapture();
  const endMs = g.now();
  await context.close();
  await browser.close();
  const out = (name) => path.join(captureDir, name);
  // concat demuxer: each frame lasts until the next one, the last one until the end.
  const lines = ["ffconcat version 1.0"];
  g.frames.forEach((f, i) => {
    const next = g.frames[i + 1]?.t ?? g.t0 + endMs;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, (next - f.t) / 1000).toFixed(4)}`);
  });
  if (g.frames.length) lines.push(`file '${g.frames.at(-1).file}'`);
  await writeFile(out("frames.txt"), lines.join("\n") + "\n");
  await writeFile(out("narration.vtt"), vtt(g.cues));
  await writeFile(out("chapters.txt"), ffmeta(g.chapters, endMs));
  await writeFile(out("recording.json"), JSON.stringify({
    scenario: scenarioId, title: scenario.intro.title, size: VIDEO, scale: SCALE, fps: CONFIG.fps, durationMs: endMs,
    pointer: { hotspot: [3, 2], ...g.pointer },
    intro: scenario.intro, outro: scenario.outro, chapters: g.chapters, cues: g.cues,
    voice: CONFIG.voice?.enabled ? { voiceId: CONFIG.voice.voiceId, modelId: CONFIG.voice.modelId } : null,
  }, null, 2));
  console.log("FRAMES", g.frames.length, "dir", frameDir, "cues", g.cues.length, "chapters", g.chapters.length, "durationMs", endMs);
  if (failed) { console.error(failed); process.exit(1); }
}
}
