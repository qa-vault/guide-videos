# Contributing

Thanks for taking the time. Two ways to help:

- **Report a problem or propose a change** in an issue. For a recording problem, include the
  scenario (or the relevant part), the `npm test` / `record.mjs` output, and your ffmpeg,
  Node and OS versions.
- **Send a change** as a pull request. Fork the repository, create a branch, commit, open a
  PR against `main`. `main` is protected: changes land only through a pull request with a
  green CI run.

## Before opening a pull request

```bash
npm install
npm test                    # unit suites
npm run test:integration    # the whole pipeline; needs ffmpeg and `npx playwright install chromium`
```

Keep a PR to one change. If it alters behaviour that a scenario can observe (helpers on `g`,
configuration keys, output files), update `README.md` and `AGENTS.md` in the same PR and add a
line under *Unreleased* in `CHANGELOG.md`. Tests follow the existing suites: assert what the
tool promises, not how it does it.

## What is out of scope

Guides themselves. `videos/` is git-ignored on purpose: a guide belongs with the product it
shows. The example in `examples/` is the only guide this repository carries.
