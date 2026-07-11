import React, { useEffect, useMemo, useRef, useState } from 'react';
import Reveal from 'reveal.js';
import Notes from 'reveal.js/plugin/notes';
import RingMark from '../ui/RingMark';
import KeyHint, { useHotkeys } from '../ui/KeyHint';
import ThemeToggle from '../ui/ThemeToggle';
import RoadToCells from '../primer/RoadToCells';
import { BlastRadiusDemo, PagerTest } from '../sections/WhyCells';
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
];

const pressKey = (key: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

const TouchBar: React.FC<{ slide: number; onPrev: () => void; onNext: () => void }> = ({
  slide,
  onPrev,
  onNext,
}) => (
  <div className="touch-bar" role="toolbar" aria-label="Slide and demo controls">
    <button className="tb-nav" onClick={onPrev} aria-label="Previous slide">←</button>
    <div className="tb-actions">
      {(SLIDE_ACTIONS[slide] ?? []).map(({ key, label }) => (
        <button key={key} className="tb-chip" title={label} aria-label={label} onClick={() => pressKey(key)}>
          {key.toUpperCase()}
        </button>
      ))}
    </div>
    <button className="tb-nav" onClick={onNext} aria-label="Next slide">→</button>
  </div>
);

/* ------------------------------------------------------------------ */
/* The deck                                                            */
/* ------------------------------------------------------------------ */

const DeckApp: React.FC = () => {
  const deckRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<{ prev: () => void; next: () => void } | null>(null);
  const [slide, setSlide] = useState(0);

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
    });
    revealRef.current = deck;
    deck.initialize().then(() => setSlide(deck.getIndices().h));
    deck.on('slidechanged', (event: unknown) => {
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
      </div>
    </div>
    {/* Deck toolbar: fixed chrome OUTSIDE .reveal (never scaled, and
        unaffected by the aside.controls resets in deck.css). */}
    <div className="deck-toolbar">
      <ThemeToggle className="dt-btn" />
    </div>
    <TouchBar
      slide={slide}
      onPrev={() => revealRef.current?.prev()}
      onNext={() => revealRef.current?.next()}
    />
    </>
  );
};

export default DeckApp;
