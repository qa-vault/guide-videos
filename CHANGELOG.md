# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

After `git pull`, run `npm install` when a release lists dependency changes, and
`npx playwright install chromium` when it lists a Playwright change. A release that changes
the default voice settings invalidates the narration cache of every guide that does not pin
them in `guides.config.local.json`.

## [0.1.1] - 2026-09-10

### Added
- `g.point(target, line, ms)`: moves the cursor to `[x, y]` or a locator, speaks the line in
  full, then pauses. Use it for "look here" beats in overview videos.

### Fixed
- Documentation of `g.say(line, ms)`: `ms` runs from the start of the line, and `g.moveTo` /
  `g.sleep` do not wait for the line. A `say` followed by `moveTo` made the cursor run one
  line ahead of the voice; use `g.point` for that.

No dependency or Playwright changes; narration caches are unaffected.

## [0.1.0] - 2026-09-10

### Added
- Scripted guide videos: `voice.mjs` (ElevenLabs narration, cached per line and neighbours),
  `record.mjs` (Playwright, paced to the narration, 2x PNG capture, pointer log),
  `compose.mjs` + `build.sh` (ffmpeg: composited cursor and click ripples, BT.709/sRGB,
  AAC narration, `mov_text` subtitles, `.vtt` and `.json` sidecars).
- Layered configuration: tracked `guides.config.json` defaults, git-ignored
  `guides.config.local.json`, `GUIDES_CONFIG` environment override for one-off runs.
- `save-login.mjs` to capture a logged-in session for `storageState`.
- `examples/invite-teammate`: a mock product, a three-scene scenario, its narration and the
  finished video.
- `AGENTS.md` playbook for coding agents (`CLAUDE.md` points to it).
- Unit, integration and mutation test suites; GitHub Actions CI.
