import React, { useEffect, useMemo, useState } from 'react';
import { hashKey, CELL_COLOR_VARS, FAILED_COLOR, DEGRADED_COLOR } from '../sim/simulation';
import Icon from '../ui/icons';
import KeyHint, { useHotkeys } from '../ui/KeyHint';

/** True when the user asked the OS for reduced motion — gates the SMIL/JS animation. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Fisher–Yates with hashKey as the PRNG, so the "random" layout is stable. */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hashKey(`${seed}-${i}`) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** C(n, k) via the multiplicative formula — exact enough in doubles for n ≤ 500. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/* ------------------------------------------------------------------ */
/* 1 · Shuffle sharding: the side-by-side scaling ladder               */
/* ------------------------------------------------------------------ */

type Hand = readonly number[];
type ClientState = 'poison' | 'down' | 'degraded' | 'fine';

/** All k-subsets of {0..n-1}, lexicographic. */
function combinations(n: number, k: number): number[][] {
  const res: number[][] = [];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) {
      res.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);
  return res;
}

const handKey = (h: Hand) => h.join('-');
const handName = (h: Hand) => h.map((w) => `W${w + 1}`).join('+');

/**
 * Deal m hands of s workers from n. Client 1 ALWAYS holds {W1..Ws} so the
 * poison story stays comparable across steps. Steps ① and ② deal in plain
 * lexicographic order — exactly the assignment from the lesson (C1=W1+W2,
 * C2=W1+W3, … C6=W3+W4); ② wraps around, so C7 repeats C1's hand. Later
 * steps shuffle deterministically (hashKey-seeded) for a realistic spread.
 * If m exceeds the number of distinct hands, the deal wraps: pigeonhole.
 */
function dealHands(n: number, s: number, m: number, seed: string | null): Hand[] {
  const all = combinations(n, s);
  const order = seed ? seededShuffle(all, seed) : all;
  const first = Array.from({ length: s }, (_, i) => i);
  const hands = [first, ...order.filter((h) => handKey(h) !== handKey(first))];
  return Array.from({ length: m }, (_, i) => hands[i % hands.length]);
}

/** Plain sharding: fixed PAIRS in every step (n/2 shards), clients filled in
    order (C1 on shard 1). Widening a plain cluster only buys in-cluster
    resiliency against a server dying — it does nothing about a poison CLIENT,
    which kills whatever serves it. So plain stays pairs across the ladder. */
function dealPlain(n: number, m: number): Hand[] {
  const shards = n / 2;
  const perShard = m / shards;
  return Array.from({ length: m }, (_, i) => {
    const shard = Math.floor(i / perShard);
    return [shard * 2, shard * 2 + 1];
  });
}

/** Poison client 1: their whole hand dies. Who else goes down / degrades? */
function ladderImpact(hands: Hand[], poisonOn: boolean) {
  const dead = new Set<number>(poisonOn ? hands[0] : []);
  const states: ClientState[] = hands.map((h, i) => {
    if (!poisonOn) return 'fine';
    if (i === 0) return 'poison';
    const hits = h.filter((w) => dead.has(w)).length;
    return hits === h.length ? 'down' : hits > 0 ? 'degraded' : 'fine';
  });
  const down = states.filter((s) => s === 'poison' || s === 'down').length;
  const degraded = states.filter((s) => s === 'degraded').length;
  const fine = states.filter((s) => s === 'fine').length;
  return { dead, states, down, degraded, fine };
}

/**
 * The four rungs. Plain sharding keeps FIXED PAIRS on every rung; the shuffle
 * side is what scales. ①→② doubles the clients (collisions return), ②→③ adds
 * two workers (enough hands again), ③→④ widens the shuffle hands to 3 and
 * grows clients to 18 — plain's blast radius keeps growing with the pool
 * while shuffle's never moves past 1. Seeds fixed so every replay deals the
 * same: step ③ reads 1 down / 6 degraded / 5 untouched, step ④ 1 / 16 / 1.
 */
const LADDER = [
  { n: 4, ss: 2, m: 6, seed: null },
  { n: 4, ss: 2, m: 12, seed: null },
  { n: 6, ss: 2, m: 12, seed: 'ladder-3b' },
  { n: 6, ss: 3, m: 18, seed: 'ladder-4a' },
] as const;

const LADDER_META = [
  {
    button: '① 4 workers · 6 clients',
    change: 'the baseline — 4 workers, 6 clients; plain cuts fixed pairs, shuffle deals hands of 2.',
    teach:
      'C(4,2) = 6 possible hands, 6 clients: every hand is dealt exactly once, so no other client holds your whole hand. The poison drowns alone; sharing one worker only degrades you — your retry lands on your other worker.',
  },
  {
    button: '② clients ×2 → 12',
    change: 'one change: double the clients → 12 (same 4 workers).',
    teach:
      'Same fleet, twice the clients: only 6 hands exist, so hands must repeat (pigeonhole) — C7 holds C1’s exact hand and drowns with it. More clients on a fixed fleet brings collisions back.',
  },
  {
    button: '③ workers +2 → 6',
    change: 'one change: add 2 workers → 6 (still 12 clients).',
    teach:
      'Two more workers and the hand supply jumps: C(6,2) = 15 ≥ 12 clients — everyone gets a unique hand again, and the poison is back to drowning alone.',
  },
  {
    button: '④ shuffle hands → 3 · 18 clients',
    change:
      'the shuffle side widens its hands 2 → 3 and clients grow to 18 — plain keeps its fixed pairs.',
    teach:
      'Widening a plain cluster to 3 would only buy in-cluster resiliency — useful when a server dies, useless against a poison client, which kills whatever serves it (and bigger shards just concentrate more clients on each). Shuffle widens instead: C(6,3) = 20 ≥ 18, still 1 down of 18 — and a single worker dying now costs each holder 1 of 3, not 1 of 2. Clients grew 6 → 12 → 18 and shuffle’s blast radius never moved.',
  },
];

export const ShuffleLadder: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [step, setStep] = useState(0);
  const [poisonOn, setPoisonOn] = useState(true);

  // Presenter keys (slide deck only): 1-4 walk the ladder, P poison, C cure
  useHotkeys(hotkeys, {
    '1': () => setStep(0),
    '2': () => setStep(1),
    '3': () => setStep(2),
    '4': () => setStep(3),
    p: () => setPoisonOn(true),
    c: () => setPoisonOn(false),
  });

  const { n, ss, m, seed } = LADDER[step];
  const meta = LADDER_META[step];

  const shuffleHands = useMemo(() => dealHands(n, ss, m, seed), [step]);
  const plainHands = useMemo(() => dealPlain(n, m), [step]);
  const shuffle = useMemo(() => ladderImpact(shuffleHands, poisonOn), [shuffleHands, poisonOn]);
  const plain = useMemo(() => ladderImpact(plainHands, poisonOn), [plainHands, poisonOn]);

  // Rows for the totals table: poison always applied, all four rungs at once.
  const totals = useMemo(
    () =>
      LADDER.map((rung) => ({
        ...rung,
        hands: choose(rung.n, rung.ss),
        plainDown: ladderImpact(dealPlain(rung.n, rung.m), true).down,
        shuffleDown: ladderImpact(dealHands(rung.n, rung.ss, rung.m, rung.seed), true).down,
      })),
    []
  );

  const pct = (down: number, of: number) => `${Math.round((100 * down) / of)}%`;

  // Other clients dealt C1's exact hand (step ②'s C7) — named in the verdict.
  const handMates = shuffleHands
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i > 0 && handKey(h) === handKey(shuffleHands[0]))
    .map(({ i }) => `C${i + 1}`);

  /* ---- shared geometry so the eye compares the two panels ---- */
  const W = 420;
  const H = 196;
  const CHIP_W = 44;
  const CHIP_GAP = 12;
  const chipX = (w: number) => (W - (n * (CHIP_W + CHIP_GAP) - CHIP_GAP)) / 2 + w * (CHIP_W + CHIP_GAP);
  const chipCX = (w: number) => chipX(w) + CHIP_W / 2;
  const CUST_Y = 158;
  const custCX = (i: number) => 26 + (i * (W - 52)) / (m - 1);

  const panel = (mode: 'plain' | 'shuffle') => {
    const hands = mode === 'plain' ? plainHands : shuffleHands;
    const { dead, states } = mode === 'plain' ? plain : shuffle;
    const workerColor = (w: number) =>
      dead.has(w) ? FAILED_COLOR : CELL_COLOR_VARS[mode === 'plain' ? Math.floor(w / 2) : w];
    const dotFill = (state: ClientState) =>
      state === 'poison' || state === 'down'
        ? FAILED_COLOR
        : state === 'degraded'
          ? DEGRADED_COLOR
          : 'var(--ink-2)';

    return (
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: W }}
        role="img"
        aria-label={
          mode === 'plain'
            ? `Plain sharding: ${n / 2} fixed pairs of workers, ${m / (n / 2)} clients each${poisonOn ? `; poison takes ${plain.down} of ${m} clients down` : ''}`
            : `Shuffle sharding: each of ${m} clients deals a hand of ${ss} from ${n} workers${poisonOn ? `; poison takes ${shuffle.down} of ${m} clients down, ${shuffle.degraded} degraded` : ''}`
        }
      >
        {/* client → worker edges, drawn first so chips and dots sit on top.
            With 18 clients × 3 edges the untouched traffic fades back so the
            poison's damage stays the loudest thing on screen. */}
        {hands.map((h, i) =>
          h.map((w) => {
            const isDead = dead.has(w);
            const quiet = poisonOn && states[i] === 'fine';
            return (
              <line
                key={`${i}-${w}`}
                x1={custCX(i)}
                y1={CUST_Y - 8}
                x2={chipCX(w)}
                y2={48}
                stroke={isDead ? FAILED_COLOR : workerColor(w)}
                strokeWidth={isDead ? 1.6 : 1.1}
                strokeDasharray={isDead ? '5 4' : undefined}
                opacity={isDead ? 0.55 : quiet ? 0.22 : 0.45}
              />
            );
          })
        )}
        {/* workers */}
        {Array.from({ length: n }, (_, w) => {
          const isDead = dead.has(w);
          return (
            <g key={w}>
              <rect x={chipX(w)} y={24} width={CHIP_W} height={24} rx={5} fill={workerColor(w)} />
              {isDead && (
                <path
                  d={`M ${chipX(w) + 6} 32.5 l 7 7 M ${chipX(w) + 13} 32.5 l -7 7`}
                  stroke="#fff"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                />
              )}
              <text
                x={chipCX(w) + (isDead ? 5 : 0)}
                y={40}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="#fff"
              >
                W{w + 1}
              </text>
            </g>
          );
        })}
        {/* clients */}
        {states.map((state, i) => (
          <g key={i}>
            <title>
              {`C${i + 1} → ${handName(hands[i])}` +
                (state === 'fine'
                  ? poisonOn
                    ? ' — untouched'
                    : ''
                  : state === 'poison'
                    ? ' — the poison client'
                    : state === 'down'
                      ? ` — fully down (same ${mode === 'plain' ? 'shard' : 'hand'} as C1)`
                      : ' — degraded: keeps a live worker, the retry lands there')}
            </title>
            {i === 0 && (
              <circle
                cx={custCX(0)}
                cy={CUST_Y}
                r={10.5}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={1.4}
                strokeDasharray={poisonOn ? undefined : '3 3'}
              />
            )}
            <circle cx={custCX(i)} cy={CUST_Y} r={m > 12 ? 5.5 : m > 6 ? 6.5 : 7.5} fill={dotFill(state)} />
            {state === 'poison' && (
              <path
                d={`M ${custCX(i) - 2.4} ${CUST_Y - 2.4} l 4.8 4.8 M ${custCX(i) + 2.4} ${CUST_Y - 2.4} l -4.8 4.8`}
                stroke="#fff"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            )}
            <text x={custCX(i)} y={CUST_Y + 22} textAnchor="middle" fontSize={m > 12 ? 6.5 : m > 6 ? 8 : 9} fill="var(--muted)">
              C{i + 1}
            </text>
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div className="panel ladder">
      <div className="controls">
        {LADDER_META.map((s2, i) => (
          <button key={i} className={step === i ? 'selected' : ''} onClick={() => setStep(i)}>
            {s2.button}
            {hotkeys && <KeyHint k={String(i + 1)} />}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {poisonOn ? (
          <button onClick={() => setPoisonOn(false)}>
            Cure client 1{hotkeys && <KeyHint k="C" />}
          </button>
        ) : (
          <button className="danger" onClick={() => setPoisonOn(true)}>
            <Icon name="skull" />Poison client 1{hotkeys && <KeyHint k="P" />}
          </button>
        )}
      </div>
      <p className="ladder-change">
        <strong>Step {step + 1} of 4</strong> — {meta.change}{' '}
        {poisonOn ? (
          <>
            Client&nbsp;1 is <strong className="lc-bad">poison</strong>: every request it sends
            crashes the worker that serves it, so everything serving it dies —{' '}
            {handKey(plainHands[0]) === handKey(shuffleHands[0]) ? (
              <>its pair ({handName(plainHands[0])}) in both worlds.</>
            ) : (
              <>
                its fixed pair ({handName(plainHands[0])}) on the left, its {ss}-wide hand
                ({handName(shuffleHands[0])}) on the right.
              </>
            )}
          </>
        ) : (
          <>Client&nbsp;1 is cured — poison it to compare the two worlds.</>
        )}
      </p>
      <div className="viz-flex" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">
            Plain shards — {n / 2} fixed pairs · {m / (n / 2)} clients each
          </div>
          {panel('plain')}
          <div className="stat">
            <div className={`value ${poisonOn ? 'bad' : ''}`} style={{ fontSize: '1.1rem' }}>
              {poisonOn ? `${plain.down} of ${m} clients down — ${pct(plain.down, m)}` : 'All healthy'}
            </div>
            <div className="label">
              {poisonOn
                ? `no degraded state exists here: a client is all-in on its pair, so C1's ${plain.down - 1} shard-mate${plain.down === 2 ? '' : 's'} drown${plain.down === 2 ? 's' : ''} with it`
                : `every client rides one fixed 2-worker pair`}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">
            Shuffle sharding — hands of {ss} dealt from {choose(n, ss)} possible
          </div>
          {panel('shuffle')}
          <div className="stat">
            <div className={`value ${poisonOn ? 'good' : ''}`} style={{ fontSize: '1.1rem' }}>
              {poisonOn ? `${shuffle.down} of ${m} down — ${pct(shuffle.down, m)}` : 'All healthy'}
            </div>
            <div className="label">
              {poisonOn
                ? handMates.length > 0
                  ? `${handMates.join(', ')} holds C1's exact hand (${handName(shuffleHands[0])}) and drowns too · ${shuffle.degraded} degraded (amber) keep a live worker · ${shuffle.fine} untouched`
                  : `nobody else holds C1's whole hand · ${shuffle.degraded} degraded (amber) keep at least one live worker · ${shuffle.fine} untouched`
                : `${m} clients, ${choose(n, ss)} possible hands of ${ss}`}
            </div>
          </div>
        </div>
      </div>
      <p className="panel-hint">{meta.teach}</p>
      <div className="legend">
        <span><span className="swatch" style={{ background: FAILED_COLOR }} />poison / fully down</span>
        <span><span className="swatch" style={{ background: DEGRADED_COLOR }} />degraded — keeps a live worker</span>
        <span><span className="swatch" style={{ background: 'var(--ink-2)' }} />untouched</span>
        <span><span className="swatch" style={{ background: FAILED_COLOR, textDecoration: 'line-through' }} />✗ dead worker</span>
      </div>
      <p className="ladder-table-caption">Totals — client 1 poisoned on every rung:</p>
      <div className="ladder-table-wrap">
      <table className="ladder-table">
        <thead>
          <tr>
            <th>step</th>
            <th>workers</th>
            <th>plain</th>
            <th>hand size</th>
            <th>clients</th>
            <th>hands C(N,S)</th>
            <th>plain down</th>
            <th>shuffle down</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t, i) => (
            <tr key={i} className={i === step ? 'current' : ''}>
              <td>{'①②③④'[i]}</td>
              <td>{t.n}</td>
              <td>pairs (fixed)</td>
              <td>{t.ss}</td>
              <td>{t.m}</td>
              <td>C({t.n},{t.ss}) = {t.hands}</td>
              <td className="lc-bad">{t.plainDown} of {t.m} · {pct(t.plainDown, t.m)}</td>
              <td className="lc-good">{t.shuffleDown} of {t.m} · {pct(t.shuffleDown, t.m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="ladder-bridge">
        keep going: 100 workers, hands of 5 → C(100,5) = 75,287,520 possible hands — the
        calculator below does the counting.
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 1b · Shuffle sharding: scale it — the calculator                    */
/* ------------------------------------------------------------------ */

const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => String(n).split('').map((d) => SUPERSCRIPTS[+d]).join('');

/** 75,287,520 below a trillion; 1.6 × 10¹⁴ above. */
const fmtBig = (v: number): string => {
  if (!isFinite(v)) return '∞';
  if (v >= 1e12) {
    const e = Math.floor(Math.log10(v));
    return `${(v / 10 ** e).toFixed(1)} × 10${sup(e)}`;
  }
  return Math.round(v).toLocaleString('en-US');
};

const fmtCount = (v: number): string =>
  v < 1.05 ? '≈ 1' : v < 10 ? `≈ ${v.toFixed(1)}` : `≈ ${fmtBig(v)}`;

const fmtPct = (x: number): string => {
  const p = 100 * x;
  if (p >= 10) return `${p.toFixed(0)}%`;
  if (p >= 1) return `${p.toFixed(1)}%`;
  if (p >= 0.01) return `${p.toFixed(2)}%`;
  return '< 0.01%';
};

const MAX_WORKERS = 200;

export const ShuffleMath: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [workers, setWorkers] = useState(100);
  const [shardSize, setShardSize] = useState(5);
  const [clientExp, setClientExp] = useState(6); // clients = 10^clientExp

  // Presenter keys (slide deck only): preset scenarios
  useHotkeys(hotkeys, {
    '1': () => { setWorkers(100); setShardSize(5); setClientExp(6); }, // Route 53 scale
    '2': () => { setWorkers(8); setShardSize(2); setClientExp(4); },   // small fleet
    '3': () => { setWorkers(200); setShardSize(7); setClientExp(7); }, // mega
  });

  const s = Math.min(shardSize, Math.floor(workers / 2));
  const clients = Math.round(10 ** clientExp);
  const combos = choose(workers, s);
  const plainShards = Math.max(1, Math.floor(workers / s));

  // Poison client: kills all S workers of their shard. Plain sharding takes
  // the whole fixed shard's population with them; shuffle sharding takes only
  // clients whose ENTIRE hand is inside the dead set — i.e. the same hand.
  const othersOnMyCombo = (clients - 1) / combos;
  const poisonShuffle = 1 + othersOnMyCombo;
  const poisonPlain = clients / plainShards;
  const chanceAnyOther = 1 - Math.exp(-othersOnMyCombo);

  // Single worker dies: every client holding it loses 1 of S — degraded, not down.
  const nodeTouched = (clients * s) / workers;

  // Growth chart: C(n, s) vs plain n/s, log scale, n up to MAX_WORKERS.
  const W = 420;
  const H = 130;
  const PAD_B = 18;
  const PAD_T = 12;
  const nMin = Math.max(4, s * 2);
  const yMax = Math.log10(choose(MAX_WORKERS, s));
  const xOf = (n: number) => ((n - nMin) / (MAX_WORKERS - nMin)) * (W - 60) + 52;
  const yOf = (v: number) => H - PAD_B - (Math.max(0, Math.log10(Math.max(1, v))) / yMax) * (H - PAD_B - PAD_T);
  const line = (f: (n: number) => number) =>
    Array.from({ length: MAX_WORKERS - nMin + 1 }, (_, i) => {
      const n = nMin + i;
      return `${xOf(n)},${yOf(f(n))}`;
    }).join(' ');
  const decades: number[] = [];
  for (let d = 3; d <= yMax; d += 3) decades.push(d);

  const slider = (
    label: string,
    value: number,
    display: string,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    aria: string
  ) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 200px' }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} aria-label={aria} />
      <span style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {display}
      </span>
    </label>
  );

  return (
    <div className="panel sm-panel">
      <div className="sm-scale">
        <div className="mini-title">Scale it — the ladder's counting at fleet size</div>
        <div className="controls">
          {slider('workers (N)', workers, String(workers), 4, MAX_WORKERS, 1, setWorkers, 'Number of workers')}
          {slider('hand size (S)', shardSize, String(s), 2, 8, 1, setShardSize, 'Workers per hand')}
          {slider('clients', clientExp, fmtBig(clients), 2, 7, 0.5, setClientExp, 'Number of clients (log scale)')}
        </div>
        {hotkeys && (
          <p className="preset-hint">
            <KeyHint k="1" /> Route 53 scale · <KeyHint k="2" /> small fleet · <KeyHint k="3" /> mega fleet
          </p>
        )}
        <div className="formula">
          ways to deal a hand of {s} from {workers} workers: C({workers},{s}) = <strong>{fmtBig(combos)}</strong>
          &nbsp;·&nbsp; plain sharding: only N/S = <strong>{fmtBig(plainShards)}</strong> fixed hands
        </div>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
          aria-label={`Possible hands C(N,${s}) grow to ${fmtBig(choose(MAX_WORKERS, s))} at ${MAX_WORKERS} workers while plain shards stay near ${Math.floor(MAX_WORKERS / s)}`}>
          {decades.map((d) => (
            <g key={d}>
              <line x1={52} y1={yOf(10 ** d)} x2={W} y2={yOf(10 ** d)} stroke="var(--grid)" />
              <text x={48} y={yOf(10 ** d) + 3} textAnchor="end" fontSize={9} fill="var(--muted)">10{sup(d)}</text>
            </g>
          ))}
          <polyline points={line((n) => Math.max(1, Math.floor(n / s)))} fill="none" stroke="var(--baseline)" strokeWidth={1.75} strokeDasharray="5 4" />
          <polyline points={line((n) => choose(n, s))} fill="none" stroke="var(--good)" strokeWidth={2} />
          <circle cx={xOf(Math.max(nMin, workers))} cy={yOf(combos)} r={4} fill="var(--good)" />
          <text x={Math.min(xOf(Math.max(nMin, workers)) + 7, W - 110)} y={Math.max(yOf(combos) - 7, 10)} fontSize={9.5} fontWeight={700} fill="var(--good)">
            C({workers},{s}) = {fmtBig(combos)}
          </text>
          <text x={W - 4} y={yOf(Math.floor(MAX_WORKERS / s)) - 5} textAnchor="end" fontSize={9} fill="var(--muted)">
            plain shards (N/S)
          </text>
          <line x1={52} y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="var(--grid)" />
          <text x={W - 4} y={H - 6} textAnchor="end" fontSize={9} fill="var(--muted)">workers →</text>
        </svg>
        <div className="stat-row">
          <div className="stat">
            <div className="value">{fmtBig(plainShards)} → {fmtBig(combos)}</div>
            <div className="label">possible hands from the same {workers} workers — plain sharding deals N/S fixed hands; shuffle can deal any of the C(N,S)</div>
          </div>
          <div className="stat">
            <div className="value">1 in {fmtBig(combos)}</div>
            <div className="label">odds another client's hand matches yours exactly — still the only way they go down with you</div>
          </div>
          <div className="stat">
            <div className="value">{othersOnMyCombo < 0.001 ? '≈ 0' : fmtCount(othersOnMyCombo).replace('≈ ', '')}</div>
            <div className="label">expected clients (of {fmtBig(clients)}) actually dealt your exact hand</div>
          </div>
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className="value bad">{fmtCount(poisonPlain)} · {fmtPct(poisonPlain / clients)}</div>
            <div className="label">go down with one poison client under plain sharding — everyone dealt the same fixed hand shares their fate</div>
          </div>
          <div className="stat">
            <div className="value good">{fmtCount(poisonShuffle)} · {fmtPct(poisonShuffle / clients)}</div>
            <div className="label">
              go down under shuffle sharding — {chanceAnyOther < 0.5
                ? `just a ${fmtPct(chanceAnyOther)} chance even one other client matches their hand`
                : 'their exact-hand matches only; everyone else keeps a live worker'}
            </div>
          </div>
          <div className="stat">
            <div className="value">{fmtCount(nodeTouched)} · {fmtPct(Math.min(1, nodeTouched / clients))}</div>
            <div className="label">
              briefly degraded when one worker dies — they lose 1 of {s} and a retry lands on
              the other {s - 1} — <strong>0 fully down</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 2 · Static stability                                                */
/* ------------------------------------------------------------------ */

const AZ_NAMES = ['us-east-1a', 'us-east-1b', 'us-east-1c'];
const DEMAND_SRV = 90; // servers the workload needs at peak
const HOT_PER_AZ = 30; // 3 × 30 = 90: exactly enough, nothing spare
const STABLE_PER_AZ = 45; // 3 × 45 = 135: any TWO AZs sum to 90
const METER_MAX = 150; // meter scale, in servers
const USER_DOTS = 30;

export const StaticStability: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [strategy, setStrategy] = useState<'hot' | 'static'>('hot');
  const [lost, setLost] = useState(false);

  // Presenter keys (slide deck only): 1/2 pick the strategy, T drops the AZ
  useHotkeys(hotkeys, {
    '1': () => setStrategy('hot'),
    '2': () => setStrategy('static'),
    t: () => setLost((v) => !v),
  });

  const perAz = strategy === 'hot' ? HOT_PER_AZ : STABLE_PER_AZ;
  const liveAzs = lost ? AZ_NAMES.length - 1 : AZ_NAMES.length;
  const surviving = perAz * liveAzs;
  const shortfall = Math.max(0, DEMAND_SRV - surviving);
  const shed = Math.round((shortfall / DEMAND_SRV) * USER_DOTS);

  const pct = (v: number) => `${(v / METER_MAX) * 100}%`;

  return (
    <div className="panel">
      <div className="controls">
        <button
          className={strategy === 'hot' ? 'selected' : ''}
          onClick={() => setStrategy('hot')}
        >
          Just enough — {HOT_PER_AZ} servers per AZ ({HOT_PER_AZ * 3} total){hotkeys && <KeyHint k="1" />}
        </button>
        <button
          className={strategy === 'static' ? 'selected' : ''}
          onClick={() => setStrategy('static')}
        >
          Statically stable — {STABLE_PER_AZ} per AZ ({STABLE_PER_AZ * 3} total){hotkeys && <KeyHint k="2" />}
        </button>
        <span style={{ flex: 1 }} />
        {!lost ? (
          <button className="danger" onClick={() => setLost(true)}><Icon name="bolt" />Lose an AZ{hotkeys && <KeyHint k="T" />}</button>
        ) : (
          <button onClick={() => setLost(false)}>Recover the AZ{hotkeys && <KeyHint k="T" />}</button>
        )}
      </div>
      <p className="panel-hint">
        The workload needs <strong>{DEMAND_SRV} servers</strong> either way. "Just enough" spreads
        exactly {DEMAND_SRV} across three AZs — {HOT_PER_AZ} each, nothing spare. "Statically
        stable" deliberately runs <strong>more per AZ</strong>: {STABLE_PER_AZ} × 3
        = {STABLE_PER_AZ * 3}, sized so any <em>two</em> AZs alone still add up
        to {DEMAND_SRV}. The bigger per-AZ number isn't overhead that crept in — it <em>is</em> the
        strategy: the replacement capacity is already running before the failure happens.
      </p>
      <div className="az-row">
        {AZ_NAMES.map((name, i) => {
          const down = lost && i === AZ_NAMES.length - 1;
          return (
            <div key={name} className={`az-card${down ? ' down' : ''}`}>
              <div className="name" style={{ color: down ? 'var(--critical)' : 'var(--ink)' }}>
                {down && <Icon name="x" size={12} strokeWidth={2.4} />}{name}{down ? ' — offline' : ''}
              </div>
              <div className="prov">
                {down ? `${perAz} servers, unreachable` : `${perAz} servers running`}
              </div>
              <div className="az-bar">
                <div
                  className="fill"
                  style={{
                    width: `${down ? 0 : (perAz / STABLE_PER_AZ) * 100}%`,
                    background: CELL_COLOR_VARS[i],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="meter-wrap">
        <div className="meter-label">
          <span>servers still serving</span>
          <span>demand = {DEMAND_SRV} servers</span>
        </div>
        <div
          className="meter"
          role="img"
          aria-label={`${surviving} servers running, ${DEMAND_SRV} needed${shortfall > 0 ? `, ${shortfall} servers short` : ''}`}
        >
          <div className="fill-ok" style={{ width: pct(Math.min(surviving, DEMAND_SRV)) }} />
          {surviving > DEMAND_SRV && (
            <div className="fill-extra" style={{ left: pct(DEMAND_SRV), width: pct(surviving - DEMAND_SRV) }} />
          )}
          {shortfall > 0 && (
            <div className="fill-gap" style={{ left: pct(surviving), width: pct(shortfall) }} />
          )}
          <div className="demand-line" style={{ left: pct(DEMAND_SRV) }} />
        </div>
      </div>
      {lost && (
        <p style={{ margin: '0.9rem 0 0' }}>
          {strategy === 'hot' ? (
            <span className="pulse-chip">
              <Icon name="clock" size={13} strokeWidth={2} /> {shortfall} servers short — asking the
              EC2 control plane for replacements, in line behind every other customer hit by the
              same event…
            </span>
          ) : (
            <span className="pulse-chip calm">
              <Icon name="check" size={13} strokeWidth={2.4} /> nothing to do — the surviving two
              AZs already run {surviving} servers
            </span>
          )}
        </p>
      )}
      <div className="user-strip" role="img" aria-label={`${shed} of ${USER_DOTS} users shed`}>
        {Array.from({ length: USER_DOTS }, (_, i) => (
          <span key={i} style={{ background: i < USER_DOTS - shed ? 'var(--good)' : FAILED_COLOR }} />
        ))}
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className={`value ${lost ? (surviving >= DEMAND_SRV ? 'good' : 'bad') : ''}`}>
            {surviving} / {DEMAND_SRV}
          </div>
          <div className="label">
            servers {lost ? 'surviving the AZ loss' : 'running'} vs servers needed
          </div>
        </div>
        <div className="stat">
          <div className={`value ${lost ? (shed > 0 ? 'bad' : 'good') : ''}`}>
            {shed} of {USER_DOTS}
          </div>
          <div className="label">users shed while capacity is short</div>
        </div>
        <div className="stat">
          <div className={`value ${lost ? (strategy === 'static' ? 'good' : 'bad') : ''}`} style={{ fontSize: '1.3rem' }}>
            {strategy === 'static' ? '0' : 'scale-up'}
          </div>
          <div className="label">actions needed at failure time</div>
        </div>
        <div className="stat">
          <div className="value">{perAz * AZ_NAMES.length}</div>
          <div className="label">
            servers you pay for on a normal day — {strategy === 'static'
              ? `50% more than demand; static stability isn't free`
              : `exactly demand, and it shows the moment an AZ dies`}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 3 · Constant work                                                   */
/* ------------------------------------------------------------------ */

const TABLE_SIZE = 48; // rows in the full health-check table
const GRID_COLS = 12;
const WINDOW = 48; // ticks visible in the left chart
const CAP_MIN = 4; // autoscaler floor (instances of work/tick)
const RAMP_UP = 3; // how fast the autoscaler can add capacity per tick
const RAMP_DOWN = 1; // …and how slowly it gives it back
const LAG = 4; // ticks before the autoscaler even sees the spike
const WAVE = 28; // storm waves repeat on this cycle…
const WAVE_LEN = 10; // …and last this long

/** Quiet-day change rate: 1–3 changes per tick, seeded so it never shifts. */
const quietChanges = (t: number) => 1 + (hashKey(`beyond-tick-${t}`) % 3);

const GRID_INDICES = Array.from({ length: TABLE_SIZE }, (_, i) => i);

export const ConstantWork: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const reduced = usePrefersReducedMotion();
  const [storm, setStorm] = useState(true);
  const [intensity, setIntensity] = useState(36);
  const [running, setRunning] = useState(() => !reduced);

  // Presenter keys (slide deck only): 1 quiet, 2 storm, G play/pause
  useHotkeys(hotkeys, {
    '1': () => setStorm(false),
    '2': () => setStorm(true),
    g: () => setRunning((r) => !r),
  });
  const [tick, setTick] = useState(WINDOW + WAVE); // start with a full window

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 650);
    return () => clearInterval(id);
  }, [running]);

  const demandAt = (t: number) =>
    quietChanges(t) + (storm && t % WAVE < WAVE_LEN ? intensity : 0);

  const sim = useMemo(() => {
    const demand: number[] = [];
    const cap: number[] = [];
    const backlog: number[] = [];
    let c = CAP_MIN;
    let b = 0;
    for (let t = 0; t <= tick; t++) {
      const d = demandAt(t);
      // the autoscaler chases demand as it looked LAG ticks ago, ramp-limited
      const target = demandAt(Math.max(0, t - LAG));
      c = Math.max(CAP_MIN, c + Math.max(-RAMP_DOWN, Math.min(RAMP_UP, target - c)));
      b = Math.max(0, b + d - c);
      demand.push(d);
      cap.push(c);
      backlog.push(b);
    }
    return { demand, cap, backlog };
  }, [tick, storm, intensity]);

  const from = Math.max(0, tick - WINDOW + 1);
  const dWin = sim.demand.slice(from);
  const cWin = sim.cap.slice(from);
  const nowDemand = sim.demand[tick];
  const nowBacklog = sim.backlog[tick];
  const nowCap = sim.cap[tick];

  // Which table rows changed value this tick (right panel). Seeded by tick so
  // pausing and resuming replays identically.
  const changedRows = useMemo(() => {
    const n = Math.min(TABLE_SIZE, nowDemand);
    return new Set(seededShuffle(GRID_INDICES, `cw-grid-${tick}`).slice(0, n));
  }, [tick, nowDemand]);

  const W = 420;
  const H = 170;
  const PAD_T = 16;
  const PAD_B = 18;
  const yMax = Math.max(TABLE_SIZE, ...dWin, ...cWin) * 1.12;
  const y = (v: number) => H - PAD_B - (v / yMax) * (H - PAD_B - PAD_T);
  const bw = W / WINDOW;

  const capLine = cWin
    .map((c, i) => `${(i + 0.5) * bw},${y(c)}`)
    .join(' ');

  return (
    <div className="panel">
      <div className="controls">
        <button className={!storm ? 'selected' : ''} onClick={() => setStorm(false)}>
          Quiet day{hotkeys && <KeyHint k="1" />}
        </button>
        <button className={storm ? 'selected' : ''} onClick={() => setStorm(true)}>
          <Icon name="cloud-bolt" />Storm waves{hotkeys && <KeyHint k="2" />}
        </button>
        <button onClick={() => setRunning((r) => !r)}>
          <Icon name={running ? 'pause' : 'play'} />{running ? 'Pause' : 'Play'}{hotkeys && <KeyHint k="G" />}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 220px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-2)' }}>storm size</span>
          <input
            type="range"
            min={8}
            max={46}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label="Changes per tick during the storm"
          />
          <span style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>
            +{intensity}/tick
          </span>
        </label>
      </div>
      <div className="viz-flex" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">Scale reactively — chase the load, always behind</div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
            aria-label={`Reactive autoscaling: demand ${nowDemand} changes this tick, capacity ${nowCap}, backlog ${nowBacklog}`}>
            {/* faint red wash behind storm ticks */}
            {dWin.map((_, i) => {
              const t = from + i;
              return storm && t % WAVE < WAVE_LEN ? (
                <rect key={`s-${t}`} x={i * bw} y={PAD_T} width={bw} height={H - PAD_T - PAD_B} fill={FAILED_COLOR} opacity={0.06} />
              ) : null;
            })}
            {/* demand bars: blue up to current capacity, red where the scaler hasn't caught up */}
            {dWin.map((d, i) => {
              const c = cWin[i];
              const within = Math.min(d, c);
              const over = d - within;
              return (
                <g key={from + i}>
                  <rect x={i * bw + 1} y={y(within)} width={bw - 2} height={y(0) - y(within)} fill="var(--cell-1)" />
                  {over > 0 && (
                    <rect x={i * bw + 1} y={y(d)} width={bw - 2} height={y(within) - y(d)} fill={FAILED_COLOR} />
                  )}
                </g>
              );
            })}
            {/* the autoscaler's capacity, trailing the spikes */}
            <polyline points={capLine} fill="none" stroke="var(--accent)" strokeWidth={2} />
            <text x={4} y={y(cWin[cWin.length - 1]) - 5} fontSize={9.5} fontWeight={600} fill="var(--accent)">
              capacity (lags {LAG} ticks, +{RAMP_UP}/tick max)
            </text>
            {nowBacklog > 0 && (
              <text x={W - 4} y={PAD_T - 4} textAnchor="end" fontSize={11} fontWeight={700} fill={FAILED_COLOR}>
                queue: {nowBacklog} updates behind
              </text>
            )}
            <line x1={0} y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="var(--grid)" />
            <text x={W - 4} y={H - 6} textAnchor="end" fontSize={9} fill="var(--muted)">
              time →
            </text>
          </svg>
          <div className="stat">
            <div className={`value ${nowBacklog > 0 ? 'bad' : ''}`} style={{ fontSize: '1.1rem' }}>
              {nowBacklog > 0
                ? `${nowBacklog} updates behind right now`
                : storm
                  ? 'caught up — until the next wave'
                  : 'keeping up (barely doing anything)'}
            </div>
            <div className="label">
              {storm
                ? 'the scaler reacts, ramps, and arrives after the front of every wave has already queued — the red area is work done late, during the exact storm it exists to report'
                : 'cheap on a quiet day; the scale-up path is the one path that never gets rehearsed'}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">Constant work — push the whole table, every tick</div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
            aria-label={`Constant work: ${TABLE_SIZE} rows processed every tick; ${Math.min(TABLE_SIZE, nowDemand)} of them are real updates this tick`}>
            {/* same faint red wash so the two charts share a clock */}
            {dWin.map((_, i) => {
              const t = from + i;
              return storm && t % WAVE < WAVE_LEN ? (
                <rect key={`cs-${t}`} x={i * bw} y={PAD_T} width={bw} height={H - PAD_T - PAD_B} fill={FAILED_COLOR} opacity={0.06} />
              ) : null;
            })}
            {/* every bar is full height (the whole table is processed every
                cycle); only the bottom slice — the same demand the left chart
                is chasing — is real updates, the rest is shaded "no change" */}
            {dWin.map((d, i) => {
              const changed = Math.min(TABLE_SIZE, d);
              return (
                <g key={from + i}>
                  <rect x={i * bw + 1} y={y(TABLE_SIZE)} width={bw - 2} height={y(changed) - y(TABLE_SIZE)} fill="var(--grid)" />
                  <rect x={i * bw + 1} y={y(changed)} width={bw - 2} height={y(0) - y(changed)} fill="var(--good)" />
                </g>
              );
            })}
            <line x1={0} y1={y(TABLE_SIZE)} x2={W} y2={y(TABLE_SIZE)} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="5 4" />
            <text x={4} y={y(TABLE_SIZE) - 5} fontSize={9.5} fontWeight={600} fill="var(--ink-2)">
              every bar: the full {TABLE_SIZE}-row table
            </text>
            <line x1={0} y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="var(--grid)" />
            <text x={W - 4} y={H - 6} textAnchor="end" fontSize={9} fill="var(--muted)">
              time →
            </text>
          </svg>
          <div className="legend" style={{ marginTop: '0.35rem' }}>
            <span><span className="swatch" style={{ background: 'var(--good)' }} />real updates (= the load on the left)</span>
            <span><span className="swatch" style={{ background: 'var(--grid)' }} />processed anyway — no change</span>
          </div>
          <div
            className="cw-grid"
            role="img"
            aria-label={`This tick's push: ${changedRows.size} of ${TABLE_SIZE} rows changed; all ${TABLE_SIZE} pushed regardless`}
          >
            {GRID_INDICES.map((i) => (
              <span key={i} className={`cw-cell${changedRows.has(i) ? ' changed' : ''}`} />
            ))}
          </div>
          <div className="stat">
            <div className="value good" style={{ fontSize: '1.1rem' }}>
              {changedRows.size >= TABLE_SIZE * 0.7
                ? 'the bar filled solid green — and its height didn\'t move'
                : `${changedRows.size} real update${changedRows.size === 1 ? '' : 's'} inside a ${TABLE_SIZE}-row push`}
            </div>
            <div className="label">
              {storm
                ? 'same load as the left chart, but here it just recolors the inside of an already-full bar — the work done per tick never changes, so there is nothing to queue'
                : 'on a quiet day almost the whole bar is shaded "no change" and still shipped — that "waste" is the storm path being rehearsed every few seconds (the grid shows this tick\'s push)'}
            </div>
          </div>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className={`value ${nowBacklog > 0 ? 'bad' : ''}`}>
            {storm ? `${Math.round((intensity + 2) / 2)}×` : '1×'}
          </div>
          <div className="label">reactive pipeline: storm work vs a quiet tick — and it queues whenever the scaler is mid-chase</div>
        </div>
        <div className="stat">
          <div className="value good">1×</div>
          <div className="label">constant-work pipeline: storm vs quiet day — the busy path IS the quiet path</div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

const BeyondCells: React.FC = () => (
  <section className="lesson" id="beyond-cells">
    <div className="kicker">07 · Beyond cells</div>
    <h2>Cells have siblings</h2>
    <p>
      Cells are one member of a family of patterns — mostly documented by Amazon's Builders'
      Library and the Route&nbsp;53 team — that all answer the same question: <em>when something
      breaks, how many people notice?</em> The family resemblance is a restaurant one: a good
      kitchen survives the lunch rush because of decisions made at 9am, not heroics at 12:05.
      Here are three more relatives, each with the same interactive treatment.
    </p>

    <h3>Shuffle sharding: give everyone their own combination</h3>
    <p>
      Cells pin each client to one partition. Shuffle sharding — the trick Route&nbsp;53 uses to
      survive DDoS attacks on individual domains — deals each client a <em>hand</em> of workers
      instead, like cards from one deck. Below, the same failure hits two worlds side by side:
      on the left the fleet is cut into fixed pairs (and stays that way), on the right every
      client is dealt its own hand from the same workers. Client&nbsp;1 is <em>poison</em> —
      its requests crash whatever serves them. Walk the four steps — grow the clients, grow
      the fleet, widen the hands — and watch the totals accumulate at the bottom: shuffle's
      blast radius never moves past one client, while plain's grows with the pool:
    </p>
    <ShuffleLadder />

    <p>
      The whole ladder is one counting argument. A poison client only drowns clients dealt
      their <em>entire</em> hand, so what matters is the supply of distinct hands:
      C(N,S)&nbsp;—&nbsp;how many ways to deal a hand of S from N workers. Plain sharding only
      ever uses N/S of them; shuffle sharding can use them all, and the supply explodes as the
      fleet grows while plain shards barely budge. Run the same numbers at fleet size:
    </p>
    <ShuffleMath />

    <h3>Static stability: pay for the failure before it happens</h3>
    <p>
      A statically stable system survives a dependency failure <em>without changing anything at
      failure time</em> — no scale-up, no control-plane calls, no reconfiguration in the critical
      moment. Concretely: if demand takes 90 servers, run 45 in each of three AZs — 135 in total,
      sized so any <em>two</em> AZs still sum to the full 90. Losing an AZ then changes nothing.
      The tempting alternative — run exactly 90 as 30 per AZ and scale up when something fails —
      needs the EC2 control plane at the exact moment an AZ-wide event has every other customer
      asking it for the same instances. Rule of thumb: the data plane must not depend on the
      control plane during recovery.
    </p>
    <StaticStability />

    <h3>Constant work: make the busy path the only path</h3>
    <p>
      Most systems do work proportional to how much is changing — cheap when calm, overwhelmed
      exactly during the storm. That's <em>bimodal</em> behavior, and the failure mode is
      correlated with the moment you can least afford it. The constant-work alternative, from
      Route&nbsp;53's health-check aggregators: push the <em>entire</em> table every few seconds,
      whether 1 row changed or 1,000. Below, both pipelines face the same storm waves: on the
      left an autoscaler chases the load and never catches the front of a wave; on the right the
      shaded "no change" rows simply flip green while the push stays exactly the same size.
    </p>
    <ConstantWork />

    <div className="callout">
      <strong>Go deeper — these ideas are borrowed, not invented here:</strong> start with{' '}
      <a href="https://builder.aws.com/content/3Ev17ZWA9QX88MmoaULAKevIR8H/resilience-lessons-from-the-lunch-rush" target="_blank" rel="noopener noreferrer">
        Resilience lessons from the lunch rush
      </a>{' '}
      (the restaurant framing for this whole family), then{' '}
      <a href="https://builder.aws.com/content/3F06NpJ8YeoIGP8VHTw4n81pFn8/workload-isolation-using-shuffle-sharding" target="_blank" rel="noopener noreferrer">
        Workload isolation using shuffle sharding
      </a>
      ,{' '}
      <a href="https://aws.amazon.com/builders-library/static-stability-using-availability-zones/" target="_blank" rel="noopener noreferrer">
        Static stability using availability zones
      </a>
      , and{' '}
      <a href="https://builder.aws.com/content/3Ev2H7t3l2eZa9xBXiZcAjz12JK/minimizing-correlated-failures-in-distributed-systems" target="_blank" rel="noopener noreferrer">
        Minimizing correlated failures in distributed systems
      </a>{' '}
      (constant work and friends). Every number in the panels above is computed live from the
      simulation — poke at them until the math feels inevitable.
    </div>
  </section>
);

export default BeyondCells;
