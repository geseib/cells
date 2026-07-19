---
name: vote-overlay
description: Add the feature-flagged section-voting overlay to a React site — per-section agree/disagree/unsure voting with comments, JSON ballot export, and a results mode that tallies multiple ballot files inline and in a summary panel. Use when asked to add reviewer voting/feedback collection to a page-based site, or to port the check123 voting overlay to another project.
---

# Vote Overlay

A self-contained, feature-flagged review system for content sites. Reviewers
vote **agree / disagree / unsure** on every section, leave comments, and
download their ballot as a JSON file; anyone can then flip to **Results**,
load everyone's ballot files, and see tallies inline under each section and
in a right-hand summary panel. No backend — votes live in localStorage,
ballots travel as files.

**Everything needed ships in this skill's `assets/` directory** — copy from
there, adapting imports and tokens to the host project:

| Asset | What it is |
|---|---|
| `assets/vote/` | The 8 source files (React 18 + TypeScript): flags store, context/provider, overlay mount, section boxes, dock, summary panel, nav button, types |
| `assets/vote-overlay.css` | The complete CSS block (token-driven, light+dark) |
| `assets/flags.html` / `assets/flags.tsx` | The hidden `/flags` page (own build entry, noindex) |
| `assets/icon-glyphs.tsx.snippet` | The 12 stroke-icon glyphs to merge into the host's icon set |

A living, wired-up example: `github.com/geseib/check123` → `site/src/vote/`
+ `site/src/App.tsx`.

## Architecture

| File | Role |
|---|---|
| `vote/flags.ts` | Feature-flag store: localStorage key + URL overrides (`?vote=on/off`, also `#vote=on`) |
| `vote/types.ts` | `Ballot` file schema (`format: 'vote-overlay/1'`), choice types, `tallySection()` |
| `vote/VoteContext.tsx` | Provider: mode (`off/vote/results`), voter name, votes map, loaded ballots, download/clear — mode+votes persist in localStorage so page switches keep state |
| `vote/VoteOverlay.tsx` | Mounts everything: **discovers sections in the DOM** via a selector and portals a vote/results box into each — no per-section wiring |
| `vote/SectionVote.tsx` | The per-section vote box, the stacked `TallyBar`, and the inline results box with the comment carousel (left/right through each voter's comment + their vote) |
| `vote/VoteDock.tsx` | Bottom-right dock: Vote/Results tabs, name field, voted-vs-available progress, Download JSON, two-step Clear, ballot file picker + list |
| `vote/ResultsPanel.tsx` | Right-side summary: every page/section across loaded ballots with tally bars; rows scroll to sections on the current page |
| `vote/NavVoteButton.tsx` | Top-menu Voting toggle — renders null unless the flag is up |

## Integration steps

1. Copy `assets/vote/` into the target project's source tree (e.g.
   `src/vote/`).
2. Icons: the components import `../ui/icons` with glyphs `check-square,
   bar-chart, thumbs-up, thumbs-down, circle-help, message-square, download,
   upload, trash, users, x, chevron-left, chevron-right, flag, panel-right`.
   Merge `assets/icon-glyphs.tsx.snippet` into the host's stroke-icon set
   (24×24 viewBox, `stroke=currentColor`, width 1.75, round caps), or remap
   the `<Icon>` import to the project's equivalent component.
3. Wrap the app and add the two mount points:
   ```tsx
   <VoteProvider pageId="guide" pageTitle="My Site — Guide" siteName="mysite">
     <nav>… <NavVoteButton /> …</nav>
     …page content…
     <VoteOverlay sectionSelector="section.lesson" />
   </VoteProvider>
   ```
   `sectionSelector` can be anything; matched elements MUST have an `id`
   (used as the section key and for scroll-to). Titles default to the
   section's first `h2` (override with `titleSelector`).
4. Multi-page sites: mount the same provider on every page with a distinct
   `pageId`/`pageTitle`. Mode and votes persist across pages via
   localStorage; the exported JSON contains every page the reviewer voted on.
5. Append `assets/vote-overlay.css` to the project's stylesheet. It is
   token-driven — map these custom properties to the project's palette if
   names differ: `--surface-1 --page --ink --ink-2 --muted --grid --border
   --accent --good --critical --degraded`. Semantics: agree=`--good`,
   disagree=`--critical`, unsure=`--degraded`.
6. Add the flags page (`assets/flags.html` + `assets/flags.tsx`) as a
   webpack/build entry and, on Vercel, set `"cleanUrls": true` so `/flags`
   serves it. Update the localStorage key prefixes in
   `flags.ts`/`VoteContext.tsx` (`check123-…`) to the project's name.

## Behaviors to preserve when porting

- **Flag-gated everywhere**: every surface renders `null` when the flag is
  down; the only entry points are `/flags` and the `?vote=on` URL param.
- **Mode survives navigation and reload** (localStorage). Loaded result
  ballots are memory-only by design — re-select files after reload.
- **Click a cast vote again to un-vote.** Comments save as you type.
- **Download** exports only sections with a choice or a non-empty comment;
  filename `<site>-votes-<voter>.json`.
- **Clear is two-step** (button re-labels with the count before wiping).
- **Ballot loading** validates `format: 'vote-overlay/1'`, reports
  loaded/rejected counts, and dedupes by voter+exportedAt.
- **No emojis** — stroke icons only, matching the host site's icon style.

## Ballot schema

```json
{
  "format": "vote-overlay/1",
  "site": "check123",
  "voter": "George",
  "exportedAt": "2026-07-18T…Z",
  "pages": {
    "guide": {
      "title": "Health Checks — Interactive Guide",
      "sections": {
        "lying-server": { "title": "…", "choice": "agree", "comment": "…" }
      }
    }
  }
}
```

## Verify after porting

Serve the build and drive with a browser: flag off → no nav button; flip on
`/flags` (or `?vote=on`) → Voting button appears; enable → one box per
section; vote+comment → progress updates; Download → valid JSON; reload →
mode and votes persist; Results tab → load 2+ ballot files → inline bars,
comment carousel, summary panel rows; Clear → two-step, zeroes out.
