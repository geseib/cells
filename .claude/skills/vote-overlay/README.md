# vote-overlay

A feature-flagged **section-voting overlay** for React content sites:
reviewers vote agree / disagree / unsure on every section, leave comments,
and download their ballot as JSON; flip to Results, load everyone's ballot
files, and see tallies inline under each section, in a comment carousel, and
in a right-hand summary panel. No backend — votes live in localStorage,
ballots travel as files.

## Origin & status

Imported production-ready from [geseib/check123](https://github.com/geseib/check123)
(`site/src/vote/`), where it is wired up and was verified end-to-end in a
headless browser: flag gating, voting, JSON download, reload persistence,
multi-ballot tallying, carousel, summary panel, and two-step clear.
Skipped `drafts/` on import because the reference integration is the eval.

## What's in this folder

- `SKILL.md` — the skill: architecture, 6-step integration, behaviors to
  preserve, ballot schema, verification checklist.
- `assets/vote/` — the 8 source files (React 18 + TypeScript).
- `assets/vote-overlay.css` — the complete token-driven CSS block.
- `assets/flags.html` / `assets/flags.tsx` — the hidden `/flags` page.
- `assets/icon-glyphs.tsx.snippet` — the 12 stroke-icon glyphs.

## Usage

In any project, ask Claude to "add the voting overlay to this site" with this
skill available (or invoke `/vote-overlay`). The skill copies `assets/vote/`
into the project, merges the icon glyphs, mounts
`<VoteProvider>` + `<NavVoteButton>` + `<VoteOverlay sectionSelector="…">`,
appends the CSS, and adds the `/flags` page as a build entry. Sections are
auto-discovered by CSS selector — no per-section wiring.

## Key design points

- Flag-gated everywhere (`/flags` page or `?vote=on` URL param); every
  surface renders null when the flag is down.
- Mode and votes persist across pages/reloads via localStorage; loaded
  result ballots are memory-only by design.
- Ballot files carry `format: 'vote-overlay/1'`; loading validates and
  dedupes by voter + exportedAt.
- Token-driven styling (light + dark), stroke icons only, no emojis.
