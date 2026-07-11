import React, { useEffect, useMemo, useRef, useState } from 'react';
import Reveal from 'reveal.js';
import Notes from 'reveal.js/plugin/notes';
import RingMark from '../ui/RingMark';
import Icon from '../ui/icons';
import KeyHint, { useHotkeys } from '../ui/KeyHint';
import ThemeToggle from '../ui/ThemeToggle';
import RoadToCells from '../primer/RoadToCells';
import { BlastRadiusDemo, PagerTest } from '../sections/WhyCells';
import { KillCellDemo } from '../sections/KillCell';
import { ScaleDemo } from '../sections/Scale';
import { ShuffleSharding, ShuffleMath, StaticStability, ConstantWork } from '../sections/BeyondCells';
import {
  arcPath,
  buildRing,
  cellColor,
  hashKey,
  makeCells,
  ownershipArcs,
  pointOnCircle,
  MAX_HASH,
} from '../sim/simulation';

/* ------------------------------------------------------------------ */
/* Stage version of route-a-client: preset buttons only (a text input  */
/* would fight reveal's keyboard shortcuts), big ring, big verdict.    */
/* ------------------------------------------------------------------ */

const RING_SIZE = 460;
const RCX = RING_SIZE / 2;
const RCY = RING_SIZE / 2;
const PRESETS = ['user123', 'customer456', 'admin789', 'alice@example.com'];

const RingRouteSlide: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [history, setHistory] = useState<{ clientId: string; hash: number; cellId: string }[]>([]);

  const cells = useMemo(() => makeCells(4), []);
  const ring = useMemo(() => buildRing(cells), [cells]);
  const arcs = useMemo(() => ownershipArcs(ring), [ring]);

  const current = history[0];
  const repeat = current && history.filter((h) => h.clientId === current.clientId).length > 1;

  const route = (clientId: string) => {
    const cell = ring.getCell(clientId);
    if (!cell) return;
    setHistory((h) => [{ clientId, hash: hashKey(clientId), cellId: cell.cellId }, ...h].slice(0, 6));
  };

  const marker = current ? pointOnCircle(RCX, RCY, 173, current.hash / MAX_HASH) : null;

  // Presenter keys (deck): 1-4 route the presets
  useHotkeys(hotkeys, {
    '1': () => route(PRESETS[0]),
    '2': () => route(PRESETS[1]),
    '3': () => route(PRESETS[2]),
    '4': () => route(PRESETS[3]),
  });

  return (
    <div className="stage-ring">
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        role="img"
        aria-label="Client position on the hash ring"
      >
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arcPath(RCX, RCY, 200, 148, arc.start, arc.end)}
            fill={cellColor(arc.cellId)}
            opacity={current && arc.cellId !== current.cellId ? 0.15 : 1}
          />
        ))}
        {marker && current && (
          <>
            <circle cx={marker.x} cy={marker.y} r={10} fill="var(--ink)" stroke="var(--surface-1)" strokeWidth={3} />
            <text x={RCX} y={RCY - 8} textAnchor="middle" fill="var(--ink)" fontSize="24" fontWeight={700}>
              {current.cellId}
            </text>
            <text x={RCX} y={RCY + 22} textAnchor="middle" fill="var(--muted)" fontSize="16">
              owns {current.clientId}
            </text>
          </>
        )}
        {!current && (
          <text x={RCX} y={RCY + 6} textAnchor="middle" fill="var(--muted)" fontSize="18">
            route a client to see it land
          </text>
        )}
      </svg>
      <div className="stage-ring-side">
        <div className="controls" style={{ justifyContent: 'center' }}>
          {PRESETS.map((p, i) => (
            <button key={p} className={current?.clientId === p ? 'selected' : ''} onClick={() => route(p)}>
              {p}
              {hotkeys && <KeyHint k={String(i + 1)} />}
            </button>
          ))}
        </div>
        {current && (
          <div className="hash-line">
            md5("{current.clientId}") → <strong>{current.hash.toLocaleString()}</strong>
          </div>
        )}
        {repeat && <div className="hash-verdict">same ID → same hash → same cell. every time, everywhere.</div>}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Touch presenter bar: on iPad/iPhone there is no keyboard, and       */
/* reveal's canvas scaling makes the embedded buttons tiny. This bar   */
/* lives OUTSIDE .reveal (never scaled), gives 44px tap targets, and   */
/* drives the demos by dispatching the same keys the hotkeys listen    */
/* for — zero extra wiring into the shared components.                 */
/* ------------------------------------------------------------------ */

const SLIDE_ACTIONS: { key: string; label: string }[][] = [
  [], // title
  [
    { key: '1', label: 'Step 1 — Monolith' },
    { key: '2', label: 'Step 2 — Scale up' },
    { key: '3', label: 'Step 3 — Scale out' },
    { key: '4', label: 'Step 4 — Blast radius' },
    { key: '5', label: 'Step 5 — Cells' },
  ],
  [
    { key: '1', label: 'One big system' },
    { key: '2', label: '4 cells' },
    { key: 't', label: 'Trigger / recover the failure' },
  ],
  [
    { key: 'd', label: 'Drain cell-2' },
    { key: 'i', label: 'Investigate the next component' },
    { key: 'r', label: 'Reset both pagers' },
  ],
  [
    { key: '1', label: 'Route user123' },
    { key: '2', label: 'Route customer456' },
    { key: '3', label: 'Route admin789' },
    { key: '4', label: 'Route alice@example.com' },
  ],
  [
    { key: '1', label: 'Toggle cell 1' },
    { key: '2', label: 'Toggle cell 2' },
    { key: '3', label: 'Toggle cell 3' },
    { key: '4', label: 'Toggle cell 4' },
    { key: 'r', label: 'Revive all cells' },
  ],
  [
    { key: 'a', label: 'Add a cell' },
    { key: 'x', label: 'Remove a cell' },
  ],
  [
    { key: 'a', label: 'Auto-demo on/off' },
    { key: 'x', label: 'Poison a random customer' },
    { key: 'c', label: 'Cure the poison' },
  ],
  [
    { key: '1', label: 'Route 53 scale preset' },
    { key: '2', label: 'Small fleet preset' },
    { key: '3', label: 'Mega fleet preset' },
  ],
  [
    { key: '1', label: 'Just enough capacity' },
    { key: '2', label: 'Statically stable' },
    { key: 't', label: 'Lose / recover the AZ' },
  ],
  [
    { key: '1', label: 'Quiet day' },
    { key: '2', label: 'Storm waves' },
    { key: 'g', label: 'Play / pause' },
  ],
  [], // fine print
  [], // closing
];

const pressKey = (key: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

/* ------------------------------------------------------------------ */
/* Clicker scripts: each slide's demo progression as an ordered list   */
/* of phases. Right-arrow (or ▶) fires the next phase's `fwd` keys —   */
/* the same synthetic keydowns the hotkeys/TouchBar already dispatch — */
/* past the last phase it advances the slide. Left-arrow steps back    */
/* via `back`; at phase 0 it goes to the previous slide. `enter` runs  */
/* on every slide entry so each slide starts from a deterministic      */
/* state. (Manual button clicks mid-slide can drift off-script; the    */
/* next slide entry re-syncs.) Letter/digit hotkeys stay as manual     */
/* overrides.                                                          */
/* ------------------------------------------------------------------ */

interface SlideScript {
  enter?: string[];                            // keys fired on entering the slide
  phases: { fwd: string[]; back: string[] }[]; // fwd steps in; back restores the previous phase
}

const SLIDE_SCRIPTS: SlideScript[] = [
  // 0 · Title
  { phases: [] },
  // 1 · Road to cells: walk the five architecture steps
  {
    enter: ['1'],
    phases: [
      { fwd: ['2'], back: ['1'] },
      { fwd: ['3'], back: ['2'] },
      { fwd: ['4'], back: ['3'] },
      { fwd: ['5'], back: ['4'] },
    ],
  },
  // 2 · Blast radius: monolith brownout → cells → contained failure
  {
    enter: ['1'], // '1' also clears any failure left over from a previous visit
    phases: [
      { fwd: ['t'], back: ['t'] },      // monolith brownout
      { fwd: ['2'], back: ['1', 't'] }, // switch to cells, calm
      { fwd: ['t'], back: ['t'] },      // one cell fails → reroute
    ],
  },
  // 3 · 2am pager: drain, then the investigation montage
  {
    enter: ['r'],
    phases: [
      { fwd: ['d'], back: ['r'] },
      { fwd: ['i', 'i', 'i', 'i', 'i'], back: ['r', 'd'] },
    ],
  },
  // 4 · Ring: route user123 twice (consistency verdict), then customer456
  {
    phases: [
      { fwd: ['1'], back: [] },
      { fwd: ['1'], back: [] },
      { fwd: ['2'], back: [] },
    ],
  },
  // 5 · Kill a cell: kill 2, then 3 (keys toggle, so back = same key)
  {
    enter: ['r'],
    phases: [
      { fwd: ['2'], back: ['2'] },
      { fwd: ['3'], back: ['3'] },
    ],
  },
  // 6 · Add a cell, twice
  {
    phases: [
      { fwd: ['a'], back: ['x'] },
      { fwd: ['a'], back: ['x'] },
    ],
  },
  // 7 · Shuffle sharding: cure = clean state (also stops any auto-demo),
  //     then a single phase toggling the auto-demo
  {
    enter: ['c'],
    phases: [{ fwd: ['a'], back: ['a'] }],
  },
  // 8 · The math: Route 53 preset → small fleet → mega
  {
    enter: ['1'],
    phases: [
      { fwd: ['2'], back: ['1'] },
      { fwd: ['3'], back: ['2'] },
    ],
  },
  // 9 · Static stability: lose AZ → recover → statically stable → lose again
  {
    enter: ['1'],
    phases: [
      { fwd: ['t'], back: ['t'] },
      { fwd: ['t'], back: ['t'] },
      { fwd: ['2'], back: ['1'] },
      { fwd: ['t'], back: ['t'] },
    ],
  },
  // 10 · Constant work: storm on entry, quiet for contrast, back to storm
  {
    enter: ['2'],
    phases: [
      { fwd: ['1'], back: ['2'] },
      { fwd: ['2'], back: ['1'] },
    ],
  },
  // 11 · Fine print
  { phases: [] },
  // 12 · Closing
  { phases: [] },
];

const TouchBar: React.FC<{
  slide: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}> = ({ slide, onPrev, onNext, onSkip }) => (
  <div className="touch-bar" role="toolbar" aria-label="Slide and demo controls">
    <button className="tb-nav" onClick={onPrev} aria-label="Back one step">◀</button>
    <div className="tb-actions">
      {(SLIDE_ACTIONS[slide] ?? []).map(({ key, label }) => (
        <button key={key} className="tb-chip" title={label} aria-label={label} onClick={() => pressKey(key)}>
          {key.toUpperCase()}
        </button>
      ))}
    </div>
    <button className="tb-nav" onClick={onNext} aria-label="Next step">▶</button>
    <button className="tb-nav" onClick={onSkip} aria-label="Skip to next slide">⏭</button>
  </div>
);

/* ------------------------------------------------------------------ */
/* The deck                                                            */
/* ------------------------------------------------------------------ */

/* Always-available escape hatch + the discoverability layer for reveal's
   built-in viewer (overview grid) and speaker view (notes + timer). Fixed
   outside .reveal so it never scales. */
const DeckToolbar: React.FC<{ onOverview: () => void; onNotes: () => void }> = ({
  onOverview,
  onNotes,
}) => (
  <div className="deck-toolbar">
    <a className="dt-btn" href="./index.html" title="Back to the interactive guide">
      <RingMark size={15} band={4} vnodes={8} /> Site
    </a>
    <button className="dt-btn" onClick={onOverview} title="All slides at a glance (O or Esc)">
      <Icon name="maximize" size={13} /> Overview
    </button>
    <button className="dt-btn" onClick={onNotes} title="Speaker view: notes, timer, next slide (S)">
      <Icon name="book-open" size={13} /> Notes
    </button>
    <ThemeToggle className="dt-btn" />
  </div>
);

interface RevealHandle {
  prev: () => void;
  next: () => void;
  left: () => void;
  right: () => void;
  up: () => void;
  down: () => void;
  isOverview: () => boolean;
  toggleOverview: () => void;
  getIndices: () => { h: number };
  getPlugin: (name: string) => unknown;
}

const DeckApp: React.FC = () => {
  const deckRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<RevealHandle | null>(null);
  const [slide, setSlide] = useState(0);
  // Current phase within the current slide's script. A ref, not state:
  // it's read/written inside reveal's keyboard callbacks and must never
  // be stale. Reset synchronously on slidechanged AND by the enter
  // effect below (the effect also fires the slide's `enter` keys).
  const phaseRef = useRef(0);

  /* Clicker navigation. All four handlers close over refs only, so the
     instances captured by reveal's config at mount never go stale. */

  // Right arrow / ▶: next phase of this slide's script; past the last
  // phase, next slide. In overview: reveal's own right.
  const stepForward = () => {
    const deck = revealRef.current;
    if (!deck) return;
    if (deck.isOverview()) {
      deck.right();
      return;
    }
    const phases = SLIDE_SCRIPTS[deck.getIndices().h]?.phases ?? [];
    if (phaseRef.current < phases.length) {
      phases[phaseRef.current].fwd.forEach(pressKey);
      phaseRef.current += 1;
    } else {
      deck.next();
    }
  };

  // Left arrow / ◀: one phase back; at phase 0, previous slide (which
  // re-enters at ITS phase 0 — no attempt to restore its final phase).
  // In overview: reveal's own left.
  const stepBack = () => {
    const deck = revealRef.current;
    if (!deck) return;
    if (deck.isOverview()) {
      deck.left();
      return;
    }
    const phases = SLIDE_SCRIPTS[deck.getIndices().h]?.phases ?? [];
    if (phaseRef.current > 0) {
      phaseRef.current -= 1;
      (phases[phaseRef.current]?.back ?? []).forEach(pressKey);
    } else {
      deck.prev();
    }
  };

  // Down arrow / ⏭: skip straight to the next slide, past any remaining
  // phases. In overview: reveal's own down.
  const skipToNext = () => {
    const deck = revealRef.current;
    if (!deck) return;
    if (deck.isOverview()) {
      deck.down();
      return;
    }
    deck.next();
  };

  // Up arrow: toggle the overview grid (open outside it, close inside it).
  const toggleOverview = () => {
    revealRef.current?.toggleOverview();
  };

  useEffect(() => {
    if (!deckRef.current) return undefined;
    const deck = new Reveal(deckRef.current, {
      plugins: [Notes],
      hash: true,
      transition: 'fade',
      backgroundTransition: 'none',
      width: 1280,
      height: 800,
      margin: 0.05,
      controls: true,
      progress: true,
      center: true,
      // slides embed clickable sims — don't let reveal swallow their clicks
      touch: true,
      preloadIframes: false,
      // never fall back to reveal's phone "scroll view": the touch bar and
      // per-slide demos need real slide semantics on iPhone-width screens
      scrollActivationWidth: 0,
      // Clicker model: arrows drive the per-slide demo scripts instead of
      // reveal's defaults. keyCode-keyed custom bindings run INSTEAD of
      // reveal's own handling (including in overview mode, hence the
      // isOverview() delegation inside each handler). Space keeps its
      // default next-slide behavior; ESC/Enter/click in overview are
      // untouched.
      keyboard: {
        37: stepBack, // ←  one phase back / previous slide
        38: toggleOverview, // ↑  overview grid
        39: stepForward, // →  next phase / next slide
        40: skipToNext, // ↓  skip to next slide
      },
    });
    revealRef.current = deck as unknown as RevealHandle;
    deck.initialize().then(() => setSlide(deck.getIndices().h));
    deck.on('slidechanged', (event: unknown) => {
      // reset synchronously so a fast next keypress can't read a stale
      // phase; the [slide] effect below re-resets and fires `enter`
      phaseRef.current = 0;
      setSlide((event as { indexh: number }).indexh);
    });
    return () => {
      try {
        deck.destroy();
      } catch {
        /* reveal throws if destroyed before ready; harmless on hot reload */
      }
    };
  }, []);

  // Fire the slide's `enter` keys on every slide entry — including the
  // initially-loaded slide (URL hashes like #/9 land here via the
  // setSlide() after initialize()). Runs as an effect on purpose: child
  // effects commit first, so the NEW slide's hotkey listeners are already
  // attached (and the old slide's detached) when these keys dispatch.
  useEffect(() => {
    phaseRef.current = 0;
    SLIDE_SCRIPTS[slide]?.enter?.forEach(pressKey);
  }, [slide]);

  return (
    <>
    <div className="reveal" ref={deckRef}>
      <div className="slides">
        {/* 1 · Title */}
        <section className="slide-title">
          <RingMark size={260} band={5} vnodes={36} />
          <h1>Cell-Based Architecture</h1>
          <p className="subtitle">Shrinking outages from "everyone" to "a few percent"</p>
          <aside className="notes">
            <p>
              Hook: "Everything fails, all the time" — Werner Vogels. Tonight is about deciding, in
              advance, how big "everything" gets to be.
            </p>
            <p>
              The emblem behind the title is a real consistent-hash ring — the same code we'll
              route clients with in a few slides. Netflix, Slack, Shopify, and AWS all run some
              version of this pattern under different names (cells, stamps, pods).
            </p>
            <p>Everything in this deck is live and interactive — no screenshots, no videos.</p>
          </aside>
        </section>

        {/* 2 · The road to cells */}
        <section>
          <h2>The road to cells</h2>
          <div className="stage-embed">
            <RoadToCells hotkeys={slide === 1} />
          </div>
          <aside className="notes">
            <p>Drive the stepper left to right. Same 24 clients on every step — only the architecture changes.</p>
            <ul>
              <li>Monolith: one box, one failure domain, blast radius 100%.</li>
              <li>Scale UP: a bigger box. There is always a bigger day; vertical scale has a ceiling.</li>
              <li>Scale OUT: N servers behind a load balancer + one shared database. Throughput solved — but a bad deploy, a poison request, a hot key still hits everyone. Shared fate.</li>
              <li>Blast radius: the shared tier has a bad day and every client flickers. Redundancy multiplies boxes, not failure domains. Redundancy ≠ isolation.</li>
              <li>Cells: partition the whole stack, pin each client to one partition. 4 failure domains, blast radius 25%. Color shows up for the first time — that's the point.</li>
            </ul>
          </aside>
        </section>

        {/* 3 · Blast radius */}
        <section>
          <h2>25%, not 100%</h2>
          <BlastRadiusDemo hotkeys={slide === 2} />
          <aside className="notes">
            <p>100 real clients, hashed onto the ring with MD5 — the same code that runs in the deployed router.</p>
            <ul>
              <li>Start on "One big system", trigger the failure: everyone flickers — a brownout with no boundary.</li>
              <li>Switch to "4 cells", trigger again: one cell dies and — watch the dots — its clients are re-hashed onto the surviving cells. They keep their origin color so you can see who moved.</li>
              <li>The rerouted clients see a blip; 70% never notice anything at all.</li>
              <li>Punchline: with N cells, a failure costs roughly 1/N of your clients — and the router moves even those.</li>
            </ul>
          </aside>
        </section>

        {/* 4 · The 2am test */}
        <section>
          <h2>The 2am test</h2>
          <PagerTest hotkeys={slide === 3} />
          <aside className="notes">
            <p>The percentage is the visible win. The deeper one: what does the on-call human have to FIGURE OUT before they can act?</p>
            <ul>
              <li>Left pager: the alarm names the failure domain. One action — drain cell-2 — clients rehash, error rate zero, go back to sleep. Root cause is a daytime problem.</li>
              <li>Right pager: the alarm names victims — client IDs with no pattern. Invite the audience to pick components to investigate. Metrics normal… inconclusive… logs are noisy…</li>
              <li>When someone finally hits Replica-B: "root cause found after N investigations — now design a safe fix. It is still 2am."</li>
              <li>Cells make the failure domain and the recovery action the same object.</li>
            </ul>
          </aside>
        </section>

        {/* 5 · The hash ring */}
        <section>
          <h2>Same answer, every time, everywhere</h2>
          <RingRouteSlide hotkeys={slide === 4} />
          <aside className="notes">
            <p>How does every router agree on who lives where — with no lookup table and no coordination?</p>
            <ul>
              <li>Click user123: MD5 the ID, take the first 4 bytes as a position on a 2³² ring, walk clockwise to the owning cell's arc.</li>
              <li>Click it again: same hash, same cell. This page runs the repository's actual ConsistentHash class — the same one deployed in the routing Lambda. md5("user123") → 1,792,101,289 is the golden value our unit tests, smoke tests, and this slide all agree on.</li>
              <li>Because the answer is a pure function of the ID, ANY router anywhere computes it — the routing layer could live in every cell, or in the client.</li>
              <li>Segue: what happens when a cell dies or we add one? That's the next section of the talk (kill-a-cell, scaling, ~1/N movement).</li>
            </ul>
          </aside>
        </section>

        {/* 6 · Kill a cell */}
        <section>
          <h2>Kill a cell. Watch who moves.</h2>
          <KillCellDemo hotkeys={slide === 5} />
          <aside className="notes">
            <p>200 clients pinned to 4 cells. Kill cell 2 (key 2): only ITS clients slide clockwise into the survivors — and they arrive still wearing their old cell's color.</p>
            <ul>
              <li>~25% remapped, 75% untouched: no global reshuffle, no stampede, no cold caches for the unaffected.</li>
              <li>Kill a second cell: still proportional. The demo won't let you kill the last one.</li>
              <li>Revive (R): everyone returns home — assignments are a pure function of the ring.</li>
              <li>Contrast with hash-mod-N: dropping N from 4 to 3 remaps nearly EVERYONE. One failure, 100% reshuffle.</li>
            </ul>
          </aside>
        </section>

        {/* 7 · Add a cell */}
        <section>
          <h2>Scale out by adding cells</h2>
          <ScaleDemo hotkeys={slide === 6} />
          <aside className="notes">
            <p>Growth is the same story as failure, in reverse. Add a cell (A): it claims ~1/(N+1) of the keyspace, a thin slice from every existing cell.</p>
            <ul>
              <li>Watch the two percentages as cells are added: consistent hashing moves ~the ideal minimum; hash-mod-N moves nearly everything, every time.</li>
              <li>Capacity planning is cookie-cutter: prove one cell's ceiling, stamp out more.</li>
              <li>The topology map: cells spread across regions and AZs — a whole-AZ event takes out only the cells inside it. The router is the only global piece.</li>
            </ul>
          </aside>
        </section>

        {/* 8 · Shuffle sharding */}
        <section>
          <h2>Shuffle sharding: everyone gets their own combination</h2>
          <ShuffleSharding hotkeys={slide === 7} />
          <aside className="notes">
            <p>Route 53's trick for surviving DDoS on a single domain. Same 8 workers, two ways to slice.</p>
            <ul>
              <li>Start auto-demo (A): the poison marches customer to customer. Left counter swings to 4-of-16 every time; right stays at 1.</li>
              <li>Plain shards: the poison kills both shard workers, taking 3 innocent neighbors along.</li>
              <li>Shuffle: no two customers share BOTH workers, so the poison's blast radius is themselves. Degraded customers retry onto their surviving worker.</li>
              <li>4 shards vs C(8,2)=28 combinations — from the same hardware.</li>
            </ul>
          </aside>
        </section>

        {/* 9 · The math */}
        <section>
          <h2>The math: combinations beat divisions</h2>
          <ShuffleMath hotkeys={slide === 8} />
          <aside className="notes">
            <p>Three presets: 1 = Route 53 scale (100 workers, shard 5, 1M clients), 2 = small fleet (8/2/10k), 3 = mega (200/7/10M).</p>
            <ul>
              <li>Preset 1: 20 plain shards become 75 MILLION combinations. Poison blast radius: 5% plain vs about one client — a 1.3% chance even one other client shares the combo.</li>
              <li>Preset 2 is the honest one: with only 70 combos and 10k clients, shuffle's edge shrinks. The pattern needs a real fleet to shine.</li>
              <li>One worker dying degrades M·S/N clients but fully downs ZERO — retries land on the other shard members.</li>
            </ul>
          </aside>
        </section>

        {/* 10 · Static stability */}
        <section>
          <h2>Static stability: pay for the failure in advance</h2>
          <StaticStability hotkeys={slide === 9} />
          <aside className="notes">
            <p>Demand needs 90 servers. Two ways to spread them over 3 AZs.</p>
            <ul>
              <li>Strategy 1 "just enough": 30 per AZ, 90 total, nothing spare. Lose the AZ (T): 60 of 90, a third of users shed, and you're calling the EC2 control plane at the worst possible moment — in line behind everyone else hit by the same event.</li>
              <li>Strategy 2 "statically stable": 45 per AZ, 135 total — any TWO AZs cover the full 90. Lose the AZ: zero actions, zero shed.</li>
              <li>The bigger per-AZ number IS the strategy, not waste. Rule: the data plane must not depend on the control plane during recovery.</li>
              <li>Honest cost: 50% more compute every normal day.</li>
            </ul>
          </aside>
        </section>

        {/* 11 · Constant work */}
        <section>
          <h2>Constant work: the busy path is the only path</h2>
          <ConstantWork hotkeys={slide === 10} />
          <aside className="notes">
            <p>Route 53's health-check aggregators push the ENTIRE table every few seconds, changed or not.</p>
            <ul>
              <li>Left: a reactive autoscaler chasing storm waves — lags 4 ticks, ramps 3/tick, and the red area is work done late, during the exact storm it exists to report. The queue counter is the pager going off.</li>
              <li>Right: same load. Every bar is already full height — the whole 48-row table, every tick. A storm just recolors the inside of the bar green. Nothing to scale, nothing to queue.</li>
              <li>Toggle quiet (1) vs storm (2): the right chart's silhouette never changes. The busy path IS the quiet path — rehearsed every few seconds of every calm day.</li>
            </ul>
          </aside>
        </section>

        {/* 12 · The fine print */}
        <section>
          <h2>The fine print</h2>
          <div className="fine-print">
            <div className="panel"><h3><Icon name="database" size={16} /> Data partitions too</h3>
              <p>Each cell owns its clients' data — that's what makes containment real. Cross-client features need an aggregation path outside the cells.</p></div>
            <div className="panel"><h3><Icon name="compass" size={16} /> The router is sacred</h3>
              <p>Every request touches it, so keep it thin — or notice the ring is a pure function and push routing into the cells or the client.</p></div>
            <div className="panel"><h3><Icon name="shuffle" size={16} /> Migration is real work</h3>
              <p>Adding a cell moves ~1/N of clients AND their data. Plan gradual drains, or pin clients with a mapping table.</p></div>
            <div className="panel"><h3><Icon name="waves" size={16} /> Share nothing, or else</h3>
              <p>One hidden shared dependency quietly reconnects every failure domain you paid to separate.</p></div>
          </div>
          <aside className="notes">
            <p>Cells are not free — say this plainly, it buys credibility.</p>
            <ul>
              <li>Data partitioning is the hard part in practice: search, analytics, leaderboards all need an out-of-cell aggregation story.</li>
              <li>Cell sizing: pick a max you can load-test, never let a cell grow past it.</li>
              <li>Ops overhead: N of everything — dashboards, deploys, quotas. Per-cell observability with the cell ID on every metric.</li>
              <li>And the failover demo caveat: real failover is health checks + DNS, not a button.</li>
            </ul>
          </aside>
        </section>

        {/* 13 · Closing */}
        <section className="slide-title">
          <blockquote className="quote closing-quote">
            "Everything fails, all the time."
            <footer>— Werner Vogels, CTO, Amazon.com</footer>
          </blockquote>
          <p className="subtitle">
            Cells decide in advance how big "everything" gets to be.
          </p>
          <p className="vendor-line">
            AWS <em>cells</em> · Azure <em>deployment stamps</em> · Google <em>cells</em> ·
            Netflix <em>cells</em> · Shopify <em>pods</em> · Slack <em>cells</em>
          </p>
          <p className="subtitle">
            Everything you just saw runs in your browser — <a href="./index.html">the interactive guide</a> ·{' '}
            <a href="./primer.html">the vendor-neutral primer</a>
          </p>
          <aside className="notes">
            <p>Wrap-up: one decision — partition the workload and pin every client to exactly one partition — bought a size limit on failures, recovery without diagnosis, and scaling by multiplication.</p>
            <ul>
              <li>The pattern is industry-wide; AWS just documented it best. Same idea, different names.</li>
              <li>Point the audience at the site — every demo tonight is live there, plus the primer, the whitepaper links, and the deployable AWS implementation.</li>
              <li>Q&A prompts to expect: cross-cell features, cell sizing, migration tooling, and "isn't this just sharding?" (answer: sharding partitions data; cells partition the ENTIRE stack, including its failures).</li>
            </ul>
          </aside>
        </section>
      </div>
    </div>
    <DeckToolbar
      onOverview={() => revealRef.current?.toggleOverview()}
      onNotes={() => {
        const notes = revealRef.current?.getPlugin('notes') as { open?: () => void } | undefined;
        notes?.open?.();
      }}
    />
    <TouchBar
      slide={slide}
      onPrev={stepBack}
      onNext={stepForward}
      onSkip={skipToNext}
    />
    </>
  );
};

export default DeckApp;
