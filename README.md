<p align="center">
  <img src="https://img.shields.io/badge/guide--videos-scripted%20product%20walkthroughs-2FB6F3?style=for-the-badge" alt="guide-videos">
</p>

<h1 align="center">guide-videos</h1>

<p align="center">
  Scripted, narrated, Retina-quality walkthrough videos of a web product — recorded by a script, not a screen recorder.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/node-%E2%89%A5%2020-339933?logo=node.js&logoColor=white" alt="Node 20+"></a>
  <a href="https://playwright.dev"><img src="https://img.shields.io/badge/playwright-%E2%89%A5%201.59-2EAD33?logo=playwright&logoColor=white" alt="Playwright"></a>
  <a href="https://ffmpeg.org"><img src="https://img.shields.io/badge/ffmpeg-%E2%89%A5%206-007808?logo=ffmpeg&logoColor=white" alt="ffmpeg"></a>
  <a href="https://elevenlabs.io"><img src="https://img.shields.io/badge/narration-ElevenLabs-000000" alt="ElevenLabs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

---

You describe a flow once, as a short scene script. The tool synthesises the narration, drives a real browser through the flow at the pace of the spoken lines, captures every frame at 2x, and encodes an MP4 with voice, subtitles and chapters that stay in sync by construction.

<p align="center">
  <b>scenario.mjs</b> &nbsp;→&nbsp; <b>voice</b> (ElevenLabs) &nbsp;→&nbsp; <b>record</b> (Playwright) &nbsp;→&nbsp; <b>build</b> (ffmpeg) &nbsp;→&nbsp; <b>guide.mp4</b>
</p>

## 🤖 Using it with an AI agent

This tool is built to be operated by a coding agent. The realistic workflow is: you clone the repository, start your product locally, and hand the rest to the agent.

```
Use the guide-videos tool in this folder (read AGENTS.md first) to produce a narrated
walkthrough of <the flow> in my product running at <url>. Ask me to log in when you
need a session. Show me the narration text before recording. Then record, build, verify
the mp4 and tell me where it is.
```

[`AGENTS.md`](AGENTS.md) is the agent's playbook (`CLAUDE.md` points to it): a step-by-step procedure from an empty checkout to a verified video, plus the rules that keep it safe and cheap. What the agent does, in order:

1. **Checks the environment** — Node, ffmpeg, `npm install`, Chromium, an ElevenLabs key in `.env`.
2. **Points the tool at your product** — `baseUrl`, design tokens for the cursor and cards, a voice. If the flow needs a login, it runs `node save-login.mjs` and asks *you* to sign in.
3. **Walks the flow in a real browser** to collect the actual control names, then **writes `videos/<id>/scenario.mjs`**: where to start, what to click, what to say.
4. **Proofreads the narration** with a dry run (`node voice.mjs <id>`), then records (`node record.mjs <id>`) and builds (`./build.sh <id>`).
5. **Verifies the output without watching it** — stream layout, colour tags, a frame per scene against the subtitles — and reports back.
6. **Cleans up** the data the recording created and hands you the guide folder.

Everything below is the reference the agent (or you) will need along the way.

## ✨ What you get

- 🎬 **One MP4 per guide** — 2880×1800, 60 fps, H.264, plays everywhere (QuickTime, Windows, VLC, browsers) with the product's true colours.
- 🗣️ **Narration that leads the pace** — every action starts with its spoken line and the next one waits until the line is finished.
- 💬 **Subtitles and chapters for free** — the narration lines become an embedded subtitle track, a `.vtt` sidecar and chapter markers.
- 🖱️ **A cursor that looks human** — eased motion and click ripples, drawn at build time so it is smooth at any capture rate.
- 🃏 **Chapter cards** at the start and end, styled from your design tokens.
- 🔁 **Re-encode without re-recording**, re-record without re-synthesising: every stage is cached inside the guide's folder.

## 🚀 Quick start

**Prerequisites:** Node 20+, `ffmpeg` and `ffprobe` on the PATH, an ElevenLabs API key.

```bash
npm install                                      # Playwright + ElevenLabs SDK
npx playwright install chromium                  # the browser used for recording
cp .env.example .env                             # then put ELEVENLABS_API_KEY=... inside
node voice.mjs voices                            # list voices, copy an id into guides.config.local.json
```

Create `guides.config.local.json` with what is specific to your product: at least `baseUrl`, and a saved session (`storageState`) if the flow needs a login. Put a scenario in `videos/<guide-id>/scenario.mjs` (start from [`examples/invite-teammate`](examples/invite-teammate)), then produce the guide in three commands:

```bash
node voice.mjs  invite-teammate                  # 1. synthesise the narration lines
node record.mjs invite-teammate                  # 2. record the flow, paced to the narration
./build.sh      invite-teammate                  # 3. encode video + voice + subtitles
```

The result is `videos/invite-teammate/invite-teammate.mp4`.

> [!IMPORTANT]
> Recording performs real actions in the product, exactly like a user. Run it against a disposable environment or clean up the data the scenario creates before recording again.

## 📁 One guide, one folder

Everything that belongs to a guide lives in `videos/<guide-id>/`. The folder *is* the guide.

```
videos/invite-teammate/
├── scenario.mjs               the script: where to start, what to click, what to say
├── narration/                 synthesised lines (WAV + timing), keyed by text and voice
├── capture/                   the raw recording: frames/, pointer log, cues, chapter marks, cursor art
├── invite-teammate.mp4        final video: picture + narration + subtitle track
├── invite-teammate.vtt        the narration as WebVTT
└── invite-teammate.json       cues, chapters, pointer log, card texts, durations
```

`videos/` is git-ignored: guides belong to the product they show, so keep them in that product's repository or wherever you keep its docs. `capture/` is large (about 1 MB per frame) and is only needed to re-encode; it is safe to delete once the MP4 is final. `narration/` is small and worth keeping: it is the paid part.

### The example guide

[`examples/invite-teammate/`](examples/invite-teammate) is a complete guide for a fictional team app, together with the app itself and the finished output:

```
examples/invite-teammate/
├── app/                       a one-page mock product (no login): node app/serve.mjs → http://localhost:3000
├── scenario.mjs               three scenes: open the dialog, fill email and role, send
├── narration/                 the synthesised lines, so the example costs no ElevenLabs credits
├── invite-teammate.mp4        what the tool produces from the above (44 s)
├── invite-teammate.vtt
└── invite-teammate.json
```

To reproduce it end to end with the defaults (no `guides.config.local.json` needed):

```bash
node examples/invite-teammate/app/serve.mjs &           # the mock product on :3000
mkdir -p videos && cp -R examples/invite-teammate videos/invite-teammate
node record.mjs invite-teammate
./build.sh invite-teammate
```

Then use it as a template: copy the folder, point `start.path` and the locators at your product, rewrite the lines. The example pins its voice in `overrides` so the bundled narration cache matches; drop that line to use the voice from your config.

### 💬 Subtitles

Every guide ships its narration as subtitles twice: an embedded `mov_text` track in the MP4 (language `eng`, flagged default) and the `<id>.vtt` sidecar. Neither is burnt into the picture, so viewers can switch them off and you can add a translation as another `.vtt` without re-encoding. Where they show up depends on the player:

| Where you publish | What to do |
|---|---|
| QuickTime, VLC, IINA, Windows Media Player, Plex | Nothing: they read the embedded track. If it is not on by default, enable it in the player (QuickTime: View → Subtitles → English). |
| Your own web page or docs site | Browsers ignore tracks inside MP4 files. Add the `.vtt` with a `<track>`: `<video controls src="guide.mp4"><track kind="subtitles" src="guide.vtt" srclang="en" label="English" default></video>`. Serve the `.vtt` from the same origin (or with CORS), or the track silently fails to load. |
| YouTube, Vimeo, Loom | Upload the `.vtt` as the caption file in the video's settings. The embedded track is dropped during their processing. |
| Slack, Telegram, chat previews | No subtitle support. Make a hard-subbed copy for that channel: `ffmpeg -i guide.mp4 -vf "subtitles=guide.vtt" -c:a copy guide-hardsub.mp4`. Keep the original as the source. |

**More languages.** The timing of every cue is fixed by the spoken narration, so a translation is the same `.vtt` with the text replaced and the timestamps untouched. Translate the cues (the `<id>.json` file holds them in a structured form, the `.vtt` is the output shape) into one file per language, named by language code: `guide.uk.vtt`, `guide.es.vtt`. Then use them the same way as the English one: upload each to YouTube or Vimeo with its language set, or add one `<track>` per language to the web page and the browser offers a language menu:

```html
<video controls src="guide.mp4">
  <track kind="subtitles" src="guide.en.vtt" srclang="en" label="English" default>
  <track kind="subtitles" src="guide.uk.vtt" srclang="uk" label="Українська">
  <track kind="subtitles" src="guide.es.vtt" srclang="es" label="Español">
</video>
```

The MP4 itself carries the narration language only. A video *narrated* in another language is a separate guide: copy the scenario, translate its lines, pin a voice for that language in `overrides` and record it under its own id (`invite-teammate-uk`); the picture is paced to the audio, so it cannot be reused.

The tool itself is the handful of files next to `videos/`:

| File | Role |
|---|---|
| `guides.config.json` | The defaults, tracked. Do not edit; override in `guides.config.local.json`. See [Configuration](#️-configuration). |
| `config.mjs` | Loads the defaults with the local file merged over them. `node config.mjs` prints the effective configuration. |
| `voice.mjs` | Walks a scenario without a browser, collects its lines, synthesises the missing ones. |
| `save-login.mjs` | Opens the product in a visible browser, waits for you to log in, saves the session for `storageState`. |
| `record.mjs` | Drives the browser, paces actions to the narration, captures 2x PNG frames, logs the pointer. |
| `compose.mjs` | Builds the ffmpeg filter graph: frame rate, cursor and ripples, colour conversion. |
| `build.sh` | Encodes the picture, mixes the narration, muxes subtitles. |

## ✍️ Writing a scenario

A scenario is an ES module exporting a **scene manifest**:

```js
// videos/invite-teammate/scenario.mjs
export default {
  start: {                                         // where the recording begins
    path: "/settings/members",                     // appended to baseUrl
    ready: ({ page }) => page.getByRole("button", { name: "Invite member" }).waitFor(),
  },
  intro: { eyebrow: "Guide 1 of 1", title: "Inviting a teammate", text: "In this guide we …" },
  outro: { eyebrow: "Done", title: "That's it", text: "The invitation stays pending until …" },
  scenes: [                                        // one chapter per scene
    {
      title: "Invite member",
      run: async ({ page, g }) => {
        await g.click(page.getByRole("button", { name: "Invite member" }), "On the Members page, click Invite member.");
        await page.getByRole("dialog").waitFor();
        await g.say("A dialog opens with two fields.", 800);
      },
    },
  ],
  overrides: { voice: { speed: 1.2 }, timing: { moveMs: 300 } },   // optional, see Configuration
};
```

`run` receives the Playwright `page` and the guide helper `g`. **Every `label` passed to a helper is a narration line.** It starts speaking when the helper starts, the next line waits until it has been spoken (plus `voice.tailMs`), and the subtitle covers exactly the spoken interval. The card texts are lines too; a card stays up at least as long as its line.

| Helper | What happens |
|---|---|
| `g.click(locator, label, { pause, ms })` | Eased cursor move to the element, click ripple, real click. `ms` overrides the travel time, `pause` the dwell before the click. |
| `g.type(text, { label, delay })` | Types with a per-key delay (`timing.typeDelayMs` by default). |
| `g.key(key, label, afterMs)` | Presses a key, then waits `afterMs` (`timing.afterKeyMs` by default). |
| `g.point(target, line, ms)` | Moves the cursor to `target` (`[x, y]` in CSS pixels, or a locator), then speaks `line`, waits until it is spoken, then `ms` more. For "look here" beats. |
| `g.say(text, ms)` | Starts a line and waits `ms` from its *start*. The line keeps playing; the next helper that speaks waits for it to finish, `g.moveTo` and `g.sleep` do not. |
| `g.hush()` | Waits for the current line to finish and closes it. |
| `g.moveTo(x, y, ms)` | Moves the cursor without clicking (CSS pixels). Does not wait for the current line; use `g.point` to move *after* a line. |
| `g.sleep(ms)` | Waits. |

> [!TIP]
> Write lines as spoken sentences and keep them short: the narration sets the rhythm of the whole video. To point at something and talk about it, use `g.point(target, line, ms)`: the cursor arrives first, the line is spoken in full, then the pause. `g.say(line, ms)` is for a line that accompanies what is already on screen; its `ms` runs from the start of the line, so use it before a helper that speaks (which waits for the line anyway), not before `g.moveTo`.

### Testing a scenario cheaply

`node voice.mjs <id>` runs the scenario in *dry-run* mode (no browser, no waits) and prints every line with its duration — a fast way to proofread the narration before recording. Lines are cached by text, neighbours, voice and speed, so editing one line re-synthesises only that line and its two neighbours.

## ⚙️ Configuration

The defaults live in `guides.config.json`, which is tracked and updated with the tool. Your product's settings go in **`guides.config.local.json`** next to it, git-ignored, and are merged over the defaults: objects (`theme`, `voice`, `timing`) merge key by key, so the file holds only what differs. A minimal one:

```json
{
  "baseUrl": "http://localhost:5173",
  "storageState": "storage-state.json",
  "theme": { "accent": "#7C5CFF", "accentText": "#9B84FF" },
  "voice": { "voiceId": "TX3LPaxmHKxFdv7VOQHJ" }
}
```

`node config.mjs` prints the effective configuration. For a one-off run, `GUIDES_CONFIG` in the environment is merged last: `GUIDES_CONFIG='{"baseUrl":"http://localhost:4173","headless":true}' node record.mjs <id>`. A scenario can further override `fps`, `voice.*` and `timing.*` through its `overrides` field; everything else is global.

### Product and browser

| Key | Type | Default | Effect |
|---|---|---|---|
| `baseUrl` | string | `http://localhost:3000` | Origin of the product. `scenario.start.path` is appended to it. |
| `storageState` | path | `""` | Optional. Playwright storage state with a logged-in session; leave empty for a product that needs no login. Relative to the current working directory. Create one with `node save-login.mjs <file>` (log in by hand, press Enter). Recording refuses to start if the file is missing. |
| `viewport.width`, `viewport.height` | number | `1440`, `900` | Layout size in CSS pixels. All scenario coordinates use this space. |
| `scale` | number | `2` | Device pixel ratio. The video is `viewport × scale`; 2 gives Retina-sharp text. |
| `colorScheme` | `"dark"` \| `"light"` | `"dark"` | `prefers-color-scheme` the product sees. |
| `headless` | boolean | `false` | `true` hides the browser window while recording. Output is identical. |

### Output

| Key | Type | Default | Effect |
|---|---|---|---|
| `fps` | number | `60` | Output frame rate. Cursor motion is rendered at this rate; frames are captured at roughly 17–23 per second and held in between. 30 halves the file size. |
| `inflight` | number | `2` | Frame captures kept in flight. 2 saturates one CPU core; more rarely helps. |
| `dirs.videos` | string | `videos` | Root folder holding one sub-folder per guide. |

### Narration (`voice`)

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` records silent videos with subtitles only; lines still pace nothing, so add waits with `g.say(line, ms)`. |
| `voiceId` | string | — | ElevenLabs voice id. `node voice.mjs voices` lists the ones your account can use. |
| `modelId` | string | `eleven_multilingual_v2` | `eleven_multilingual_v2`: steady, best for narration. `eleven_v3`: more expressive. `eleven_flash_v2_5`: cheaper and faster, lower quality. |
| `outputFormat` | string | `pcm_44100` | Raw PCM keeps the mix lossless; the final track is AAC 160 kbps. |
| `stability`, `similarityBoost` | 0–1 | `0.5`, `0.75` | ElevenLabs voice settings. Higher stability = flatter, more predictable delivery. |
| `speed` | 0.7–1.2 | `1.1` | Speaking rate. Changing it re-synthesises (it is part of the cache key). |
| `tailMs` | ms | `150` | Silence kept after each line before the next action may start. |

### Pacing (`timing`)

| Key | Default | Effect |
|---|---|---|
| `introCardMs`, `outroCardMs` | `4000` | Minimum time the opening/closing card stays up (longer if its line is longer). |
| `afterCardMs` | `500` | Pause after a card fades out. |
| `cueGapMs` | `120` | Gap between the end of one subtitle and the start of the next. |
| `moveMs` | `400` | Cursor travel time for a click (ease-in-out). |
| `clickPauseMs` | `200` | Dwell on the target before the click. |
| `afterClickMs` | `200` | Pause after a click. |
| `afterKeyMs` | `300` | Pause after `g.key()`. |
| `typeDelayMs` | `8` | Per-key delay for `g.type()`. 8 reads as fast typing; 40+ looks like hunt-and-peck. |
| `afterTypeMs` | `300` | Pause after `g.type()`. |

### Look (`theme`)

These style the cursor, the click ripple and the chapter cards. Set them to your product's design tokens.

| Key | Default | Used for |
|---|---|---|
| `font` | `Inter, system-ui, sans-serif` | Card title and text |
| `monoFont` | `"JetBrains Mono", ui-monospace, monospace` | Card eyebrow |
| `accent` | `#2FB6F3` | Click ripple |
| `accentText` | `#4CC3F7` | Card eyebrow colour |
| `text`, `muted` | `#E6E9EC`, `#9AA3AC` | Card title / card text |
| `scrim` | `rgba(10,12,14,.55)` | Card backdrop (the page is blurred behind it) |
| `cursorFill`, `cursorStroke` | `#FFFFFF`, `#0A0C0E` | Cursor arrow |

### Per-scenario overrides

```js
overrides: {
  fps: 30,
  voice: { voiceId: "…", speed: 1.0 },
  timing: { introCardMs: 6000 },
}
```

Overrides are merged over the config for that guide only, in every stage (`voice`, `record`, `build`).

### Environment

| Variable | Where | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | `.env` next to the tool, or the environment | Text-to-speech. The key needs the *Text to Speech* scope; *Voices: read* additionally for `voice.mjs voices`. |
| `RANGE` | `build.sh` environment | `tv` (default) or `pc` video range. Leave at `tv` unless you know why. |

## 🔬 How it works

<details>
<summary><b>Narration first, then picture</b></summary>

`voice.mjs` executes the scenario against a stub page: no browser, no waits, every helper just records its line. The lines are synthesised in order with the previous and next line passed as continuity context (`previousText` / `nextText`), so the delivery does not jump between lines. Each line is stored as a WAV plus its character timings.

`record.mjs` loads those durations and refuses to start if a line is missing. During recording, every helper that carries a line first waits for the previous line to finish, then logs the start time of the new line and performs its action. That is the whole synchronisation mechanism: the picture is paced to the audio, so nothing has to be aligned afterwards.
</details>

<details>
<summary><b>Capture</b></summary>

Frames are taken with the Chrome DevTools `Page.captureScreenshot` command with `clip.scale = 2`, as lossless PNG, two requests in flight. (The DevTools screencast only ever returns CSS-size frames, and Playwright's built-in video is a low-bitrate WebM, so neither is used.) Each frame carries its request timestamp; the build resamples the sequence to a constant frame rate.
</details>

<details>
<summary><b>Cursor</b></summary>

The page never shows a fake cursor. The recorder moves the real mouse along an eased path — so hover states are genuine — and logs move segments and clicks. At build time the browser-rendered cursor image is composited by ffmpeg with x/y expressed as functions of time, and click ripples are short image sequences enabled around each click. Motion is therefore smooth at the output frame rate even though the UI is captured at ~20 fps.
</details>

<details>
<summary><b>Colour</b></summary>

Browser output is sRGB. The frames are converted to BT.709 4:2:0 through an RGB intermediate with accurate rounding, TV range, and the transfer characteristic is tagged sRGB (`iec61966-2-1`, nclc 1-13-1). This is the combination that renders identically in colour-managed players (macOS QuickTime, Safari) and in players that assume sRGB (Windows, VLC, Chrome). Reference: [Web Color Preservation, ffmpeg-tests](https://richardssam.github.io/ffmpeg-tests/WebColorPreservation.html).
</details>

<details>
<summary><b>Mux</b></summary>

Narration clips are placed at their logged start times and mixed into one AAC track. Subtitles are muxed as `mov_text` (the codec QuickTime and most players read inside MP4). Chapters are written to `capture/chapters.txt` in FFMETADATA format and to the `.json`; they are not written into the MP4 because ffmpeg's chapter track triggers flicker in some players.
</details>

## 🧪 Tests

```bash
npm test                    # unit suites: config merge, filter graph, narration cache (ElevenLabs intercepted), scenario dry run
npm run test:integration    # the whole pipeline against the bundled mock app: real Chromium + ffmpeg, ~2 min, port 3000
npm run test:mutation       # Stryker over the four unit modules
```

The unit suites never reach the network or a browser. The integration suite records and builds the example guide from its bundled narration cache on a free port, headless, so it needs no ElevenLabs key and touches nothing on the machine. Both run in GitHub Actions on every push and pull request; the mutation run is manual, before a release.

## 🔄 Updating the tool

The tool is a git checkout; your product's files live in git-ignored paths (`guides.config.local.json`, `.env`, `storage-state.json`, `videos/`) and are never touched by an update.

```bash
git pull
npm install                        # when package.json changed
npx playwright install chromium    # when the Playwright version changed
```

Read [`CHANGELOG.md`](CHANGELOG.md) before pulling: a change to the default `voice.speed`, `voiceId` or model invalidates the narration cache of every guide, and re-synthesising costs credits. If you have pinned those in `guides.config.local.json`, your cache is unaffected by upstream changes. Releases are tagged (`v0.1.0`), so `git checkout v0.1.0` pins a known version.

## 🤝 Contributing

Issues and pull requests are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md). `main` only changes through pull requests with a green CI run.

## 🧰 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `record.mjs` exits with "narration line(s) not synthesised yet" | Run `node voice.mjs <id>` first. Happens after editing any line. |
| `Cannot find package 'playwright'` or a missing browser | Run `npm install` and `npx playwright install chromium` in this folder. |
| Colours look greenish or washed out in QuickTime | Check `ffprobe`: `color_transfer` must be `iec61966-2-1`, `color_range` `tv`. Rebuild with `./build.sh`. |
| Video pauses for a second at some point | The page was re-rendering heavily and screenshots stalled. Add a short `g.sleep()` before that action or lower `inflight` to 1. |
| A line sounds wrong | Edit it in the scenario; only that line and its neighbours are re-synthesised. Then re-record: the picture is paced to the audio. |

Useful checks:

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,color_range,color_transfer -of csv=p=0 videos/<id>/<id>.mp4
node voice.mjs <id>          # prints every line with its duration
```

## 🤝 Contributing

Issues and pull requests are welcome. Keep changes small and focused; the tool intentionally has no framework and no build step. If you add a configuration key, document it in the tables above in the same change.

## 📄 License

[MIT](LICENSE)
