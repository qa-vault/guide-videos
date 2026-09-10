# guide-videos — agent playbook

You are producing a narrated walkthrough video of a web product with this tool. The human
gives you the product and the flow to show; you deliver `videos/<guide-id>/<guide-id>.mp4`.
This file is the procedure. `README.md` is the reference (every config key, every helper).

## The pipeline

```
scenario.mjs  →  node voice.mjs <id>  →  node record.mjs <id>  →  ./build.sh <id>  →  mp4 + vtt + json
 (you write)     (ElevenLabs, cached)    (Playwright, real UI)    (ffmpeg)
```

Narration leads: every label you pass to a helper is spoken, and the next action waits until
the line has been spoken. The video's rhythm is the rhythm of the lines you write.

## Step 0 — Check the environment

Run these before anything else and fix what is missing:

```bash
node --version                      # 20 or newer
ffmpeg -version | head -1           # ffmpeg 6 or newer, ffprobe alongside
npm install                         # Playwright + ElevenLabs SDK
npx playwright install chromium     # the recording browser
test -f .env || cp .env.example .env
```

`.env` must contain `ELEVENLABS_API_KEY=...` (Text to Speech + Voices read scopes). If it is
empty, stop and ask the human for the key; do not look for it elsewhere.

## Step 1 — Point the tool at the product

Create `guides.config.local.json` next to `guides.config.json`. It is git-ignored and is
merged over the defaults (objects key by key), so it holds only what is specific to this
product. Never edit `guides.config.json` itself: it is updated with the tool and edits
there break `git pull`. `node config.mjs` prints the effective result. For a single run
(a different port, headless), pass `GUIDES_CONFIG='{"baseUrl":"..."}'` in the environment
instead of editing files. Keys to set:

- `baseUrl`: the running product, usually a local dev server. Confirm it answers
  (`curl -sI $baseUrl`) before going further.
- `storageState`: leave `""` if the flow needs no login. Otherwise the recorder needs a
  Playwright storage state with a logged-in session. Get one with:
  ```bash
  node save-login.mjs storage-state.json
  ```
  It opens a visible browser; the **human** logs in and presses Enter in the terminal. Ask
  them to do it — you do not have their credentials and must not ask for them. If the
  product has a scripted test login (a seeded user, an e2e auth fixture), you may use that
  with Playwright's `page.context().storageState({ path })` instead.
- `theme`: copy the product's design tokens (accent colour, text colours, fonts) so the
  cursor, ripple and chapter cards look native. Look in the product's CSS variables or
  Tailwind theme.
- `colorScheme`: what the product's users normally see.
- `voice.voiceId`: run `node voice.mjs voices`, pick one that suits the product's tone, and
  tell the human which one you chose. Everything else in `voice` and `timing` is tuned;
  leave it unless the human asks for a different pace.

Never point `baseUrl` at production. Recording performs real actions and creates real data.

If the human asks to update the tool: `git pull`, then `npm install` and
`npx playwright install chromium` when the release notes say so. Their local files are
not touched. Warn them if a release changes default voice settings: the narration cache of
every guide would miss, unless `voice` is pinned in `guides.config.local.json`.

## Step 2 — Learn the flow before scripting it

Open the product with Playwright and walk the flow by hand: navigate to the start page,
click through every step, note the exact accessible names of the controls (role + name) and
what appears after each action. Scenarios use `page.getByRole(...)` locators; take the names
from the live accessibility tree, not from guesses or from source code you have not seen
rendered. If the flow needs data that does not exist yet (a project, a record), create it
before recording and note it for cleanup.

## Step 3 — Write the scenario

Create `videos/<guide-id>/scenario.mjs` (kebab-case id, it becomes the file names). Start
from `examples/invite-teammate/scenario.mjs` and keep the same shape:

- `start.path` is appended to `baseUrl`; `start.ready` waits for something that proves the
  page is usable.
- `intro` / `outro` cards: `eyebrow` (short, mono), `title`, `text` (spoken).
- One `scene` per chapter, 2–6 scenes. Each `run` does a few actions with the helpers on `g`:
  `g.click(locator, line)`, `g.type(text)`, `g.key(key, line)`, `g.say(line, msAfter)`,
  `g.hush()`, `g.sleep(ms)`.

Writing the lines:

- Spoken sentences, present tense, second person plural ("we open…", "click…"). One action
  per line. 6–18 words. No markup, no IDs, no file paths — it is read aloud.
- Say where the control is when it is not obvious ("in the top-right corner").
- Use `g.say(line, ms)` for beats where the viewer needs to look; 500–1500 ms is enough.
- Wait for the UI after every action (`await page.getByRole(...).waitFor()`) before the next
  line; the recorder does not know what the product does.

Then proofread the narration without a browser:

```bash
node voice.mjs <guide-id>       # dry run: prints every line with its spoken duration
```

This call synthesises the lines (paid). Get the text right first; every edited line is
re-synthesised together with its two neighbours.

## Step 4 — Record and build

```bash
node record.mjs <guide-id>      # visible browser, real actions, ~1 MB per captured frame
./build.sh <guide-id>           # mp4 + vtt + json in videos/<guide-id>/
```

`record.mjs` refuses to start if a line is not synthesised yet or the storage state file is
missing; both messages say what to do. If the recording fails mid-way (usually a
locator that never appeared), the Playwright error names the locator; fix the scenario and
re-run, the capture folder is recreated each time. Keep the machine idle
while recording: capture rate drops under load and the cursor motion is rendered from the
pointer log, so a slow capture still looks smooth, but the picture pauses.

## Step 5 — Verify the result without watching it

```bash
ffprobe -v error -show_entries stream=codec_type,width,height,r_frame_rate,color_transfer -show_entries format=duration -of default=nw=1 videos/<id>/<id>.mp4
```

Expect a `video` stream at `viewport × scale` with `color_transfer=iec61966-2-1`, an `audio`
stream and a `subtitle` stream. Then extract a few frames and look at them:

```bash
ffmpeg -v error -ss 12 -i videos/<id>/<id>.mp4 -frames:v 1 -y /tmp/f12.png
```

Check that the cursor is visible, the intended UI state is on screen, and the subtitle in
`<id>.vtt` at that second describes what you see. Look at one frame per scene at least.
Report the duration, the file size and what you checked. The human makes the final call
after watching it.

## Step 6 — Clean up

- Undo the data the recording created in the product (delete the record, revert the
  setting) so the guide can be recorded again from the same start state.
- Stop any server you started for the recording.
- The guide stays in `videos/<id>/` of this checkout; the folder is git-ignored on purpose,
  so nothing is committed by accident. Tell the human where it is. You may suggest keeping
  `scenario.mjs`, `narration/` and the three output files next to the product's docs, but
  do not move them unless asked. `capture/` is only needed to re-encode; say it can be
  deleted once the mp4 is accepted.
- Tell the human how the subtitles will behave where they plan to publish the video (see
  "Subtitles" in README.md): desktop players use the embedded track, a web page needs the
  `.vtt` in a `<track>`, YouTube and Vimeo need the `.vtt` uploaded, chat apps show none
  unless a hard-subbed copy is made with ffmpeg.

## Subtitles in other languages

When asked for subtitles in another language, do not re-record. Translate the cue texts of
`videos/<id>/<id>.vtt` (or the `cues` in `<id>.json`) keeping every timestamp exactly as it
is, and write `videos/<id>/<id>.<lang>.vtt` with the two-letter language code. Keep each
translated cue about as long as the original so it fits the same on-screen time. Explain
how to use the files (one upload per language on YouTube and Vimeo, one `<track>` per
language on a web page). A video narrated in another language is a new guide: a translated
copy of the scenario under its own id, with a voice for that language pinned in
`overrides`, recorded from scratch.

## Rules

- Never commit `.env`, `guides.config.local.json`, storage state files or captured frames.
- Do not change `record.mjs`, `compose.mjs` or `build.sh` to make one guide work. If a
  flow cannot be expressed with the scenario helpers, say so; the tool is deliberately small.
- Do not re-synthesise narration to "try" a voice: list voices, pick one, generate once.
  Changing `voice.speed` or `voiceId` invalidates the whole narration cache of every guide.
- One guide = one folder = one flow. A different flow is a different guide id, not a longer
  scenario.
