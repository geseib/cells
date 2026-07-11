import React, { useEffect, useMemo, useState } from 'react';
import { hashKey, CELL_COLOR_VARS, FAILED_COLOR } from '../sim/simulation';
import Icon from '../ui/icons';
import KeyHint, { useHotkeys } from '../ui/KeyHint';

/** True when the user asked the OS for reduced motion — gates the SMIL/JS animation. */
function usePrefersReducedMotion(): boolean {
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

/* ------------------------------------------------------------------ */
/* 1 · Shuffle sharding                                                */
/* ------------------------------------------------------------------ */

const WORKER_COUNT = 8;
const CUSTOMER_COUNT = 16;
const SHARD_SIZE = 2;
const PLAIN_SHARDS = WORKER_COUNT / SHARD_SIZE; // 4

type Pair = readonly [number, number];
type CustomerState = 'poison' | 'down' | 'degraded' | 'fine';

/** All C(8,2) = 28 possible two-worker combinations. */
const ALL_PAIRS: Pair[] = (() => {
  const pairs: Pair[] = [];
  for (let a = 0; a < WORKER_COUNT; a++) {
    for (let b = a + 1; b < WORKER_COUNT; b++) pairs.push([a, b]);
  }
  return pairs;
})();

/** Fisher–Yates with hashKey as the PRNG, so the "random" layout is stable. */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hashKey(`${seed}-${i}`) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Plain sharding: customer i belongs to shard ⌊i/4⌋, which owns two fixed workers. */
const PLAIN_PAIRS: Pair[] = Array.from({ length: CUSTOMER_COUNT }, (_, i) => {
  const shard = Math.floor(i / (CUSTOMER_COUNT / PLAIN_SHARDS));
  return [shard * SHARD_SIZE, shard * SHARD_SIZE + 1] as const;
});

/** Shuffle sharding: 16 distinct pairs drawn (deterministically) from the 28. */
const SHUFFLE_PAIRS: Pair[] = seededShuffle(ALL_PAIRS, 'beyond-shuffle').slice(0, CUSTOMER_COUNT);

/** The order the auto-demo (and the "poison a random customer" button) walks through. */
const AUTO_ORDER: number[] = seededShuffle(
  Array.from({ length: CUSTOMER_COUNT }, (_, i) => i),
  'beyond-auto'
);

function shardImpact(pairs: Pair[], poison: number | null) {
  const deadWorkers = new Set<number>(poison === null ? [] : pairs[poison]);
  const states: CustomerState[] = pairs.map((p, i) => {
    if (i === poison) return 'poison';
    const hits = p.filter((w) => deadWorkers.has(w)).length;
    return hits === p.length ? 'down' : hits > 0 ? 'degraded' : 'fine';
  });
  return { deadWorkers, states };
}

export const ShuffleSharding: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const reduced = usePrefersReducedMotion();
  const [poison, setPoison] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-demo: march the poison through every customer so the counters tell
  // the story hands-free. Any manual click takes over.
  useEffect(() => {
    if (!auto) return undefined;
    setPoison(AUTO_ORDER[step % CUSTOMER_COUNT]);
    const id = setInterval(() => {
      setStep((s) => {
        const next = s + 1;
        setPoison(AUTO_ORDER[next % CUSTOMER_COUNT]);
        return next;
      });
    }, 2000);
    return () => clearInterval(id);
  }, [auto]);

  const pickManually = (i: number | null) => {
    setAuto(false);
    setPoison(i);
  };

  const poisonNext = () => {
    setAuto(false);
    setStep((s) => {
      const next = s + 1;
      setPoison(AUTO_ORDER[next % CUSTOMER_COUNT]);
      return next;
    });
  };

  // Presenter keys (slide deck only): A auto-demo, X poison next, C cure
  useHotkeys(hotkeys, {
    a: () => setAuto((v) => !v),
    x: poisonNext,
    c: () => pickManually(null),
  });

  const plain = useMemo(() => shardImpact(PLAIN_PAIRS, poison), [poison]);
  const shuffle = useMemo(() => shardImpact(SHUFFLE_PAIRS, poison), [poison]);

  const fullyDown = (states: CustomerState[]) =>
    states.filter((s) => s === 'poison' || s === 'down').length;
  const degraded = (states: CustomerState[]) => states.filter((s) => s === 'degraded').length;

  const W = 420;
  const H = 190;
  const workerBoxX = (w: number) => 14 + w * 49;
  const workerCX = (w: number) => workerBoxX(w) + 22;
  const custCX = (i: number) => 22 + (i * (W - 44)) / (CUSTOMER_COUNT - 1);
  const CUST_Y = 156;

  const panel = (mode: 'plain' | 'shuffle') => {
    const pairs = mode === 'plain' ? PLAIN_PAIRS : SHUFFLE_PAIRS;
    const { deadWorkers, states } = mode === 'plain' ? plain : shuffle;
    const workerColor = (w: number) =>
      deadWorkers.has(w)
        ? FAILED_COLOR
        : CELL_COLOR_VARS[mode === 'plain' ? Math.floor(w / SHARD_SIZE) : w];
    const customerColor = (i: number) =>
      mode === 'plain' ? CELL_COLOR_VARS[Math.floor(i / (CUSTOMER_COUNT / PLAIN_SHARDS))] : 'var(--ink-2)';

    return (
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        style={{ maxWidth: W }}
        role="img"
        aria-label={
          mode === 'plain'
            ? 'Plain sharding: four fixed shards of two workers, four customers per shard'
            : 'Shuffle sharding: every customer gets their own two-worker combination'
        }
      >
        {/* customer → worker links, drawn first so boxes and dots sit on top */}
        {pairs.map((p, i) =>
          p.map((w) => {
            const dead = deadWorkers.has(w);
            return (
              <line
                key={`${i}-${w}`}
                x1={custCX(i)}
                y1={CUST_Y - 8}
                x2={workerCX(w)}
                y2={52}
                stroke={dead ? FAILED_COLOR : workerColor(w)}
                strokeWidth={dead ? 1.8 : 1.3}
                strokeDasharray={dead ? '5 4' : undefined}
                className={dead ? 'flow-broken' : undefined}
                opacity={dead ? 0.9 : 0.55}
              />
            );
          })
        )}
        {/* live traffic: one request dot per healthy link, forever in flight.
            Dead links get no dots — traffic visibly stops where the failure is. */}
        {!reduced &&
          pairs.map((p, i) => {
            const state = states[i];
            if (state === 'poison' || state === 'down') return null;
            return p.map((w) => {
              if (deadWorkers.has(w)) return null;
              const dur = 1.3 + (hashKey(`dot-dur-${mode}-${i}-${w}`) % 700) / 1000;
              const begin = -((hashKey(`dot-${mode}-${i}-${w}`) % 2000) / 1000);
              return (
                <circle key={`dot-${i}-${w}`} r={2.4} fill={workerColor(w)} opacity={0.85}>
                  <animateMotion
                    dur={`${dur}s`}
                    begin={`${begin}s`}
                    repeatCount="indefinite"
                    path={`M ${custCX(i)} ${CUST_Y - 8} L ${workerCX(w)} 52`}
                  />
                </circle>
              );
            });
          })}
        {/* workers */}
        {Array.from({ length: WORKER_COUNT }, (_, w) => {
          const dead = deadWorkers.has(w);
          return (
            <g key={w}>
              <rect x={workerBoxX(w)} y={26} width={44} height={26} rx={5} fill={workerColor(w)} />
              {dead && (
                <path
                  d={`M ${workerBoxX(w) + 6} 35.5 l 7 7 M ${workerBoxX(w) + 13} 35.5 l -7 7`}
                  stroke="#fff" strokeWidth={1.75} strokeLinecap="round"
                />
              )}
              <text x={workerCX(w) + (dead ? 5 : 0)} y={43} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
                W{w + 1}
              </text>
            </g>
          );
        })}
        {/* customers */}
        {states.map((state, i) => {
          const fill =
            state === 'poison' || state === 'down' ? FAILED_COLOR : customerColor(i);
          return (
            <g
              key={i}
              onClick={() => pickManually(poison === i ? null : i)}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pickManually(poison === i ? null : i);
                }
              }}
              aria-label={`customer-${i + 1}: ${state === 'fine' ? 'click to poison' : state}`}
            >
              <title>
                {`customer-${i + 1} → W${pairs[i][0] + 1}+W${pairs[i][1] + 1}` +
                  (state === 'fine' ? ' (click to poison)' : ` — ${state}`)}
              </title>
              {/* generous invisible hit target */}
              <circle cx={custCX(i)} cy={CUST_Y} r={12} fill="transparent" />
              <circle cx={custCX(i)} cy={CUST_Y} r={7} fill={fill} opacity={state === 'down' ? 0.85 : 1} />
              {state === 'poison' && (
                <path
                  d={`M ${custCX(i) - 2.5} ${CUST_Y - 2.5} l 5 5 M ${custCX(i) + 2.5} ${CUST_Y - 2.5} l -5 5`}
                  stroke="#fff" strokeWidth={1.6} strokeLinecap="round"
                />
              )}
              {state === 'degraded' && (
                <circle
                  cx={custCX(i)}
                  cy={CUST_Y}
                  r={10.5}
                  fill="none"
                  stroke={FAILED_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                />
              )}
            </g>
          );
        })}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
          {CUSTOMER_COUNT} customers — click one to poison it
        </text>
      </svg>
    );
  };

  const plainDown = fullyDown(plain.states);
  const shuffleDown = fullyDown(shuffle.states);

  return (
    <div className="panel">
      <div className="controls">
        <button className={auto ? 'selected' : ''} onClick={() => (auto ? setAuto(false) : setAuto(true))}>
          <Icon name={auto ? 'pause' : 'play'} />{auto ? 'Stop the demo' : 'Auto-demo'}{hotkeys && <KeyHint k="A" />}
        </button>
        <button onClick={poisonNext}><Icon name="skull" />Poison a random customer{hotkeys && <KeyHint k="X" />}</button>
        <span style={{ flex: 1 }} />
        {poison !== null && <button onClick={() => pickManually(null)}>Cure the poison{hotkeys && <KeyHint k="C" />}</button>}
      </div>
      <p className="panel-hint">
        {auto
          ? 'The demo is poisoning one customer after another — watch the left counter swing while the right one never moves.'
          : 'The dots in flight are live requests. Poison any customer (click it) and traffic stops exactly where the failure lands — a whole shard on the left, one combination on the right.'}
      </p>
      <div className="viz-flex" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">Plain sharding — {PLAIN_SHARDS} fixed shards of {SHARD_SIZE}</div>
          {panel('plain')}
          <div className="stat">
            <div className={`value ${poison !== null ? 'bad' : ''}`} style={{ fontSize: '1.1rem' }}>
              {poison === null ? 'Waiting for trouble' : `${plainDown} of ${CUSTOMER_COUNT} customers down`}
            </div>
            <div className="label">
              {poison === null
                ? `each customer shares a 2-worker shard with 3 neighbors`
                : 'the poison request kills both shard workers, so every shard-mate goes down with them'}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">Shuffle sharding — each customer's own 2-of-8 combo</div>
          {panel('shuffle')}
          <div className="stat">
            <div className={`value ${poison !== null ? 'good' : ''}`} style={{ fontSize: '1.1rem' }}>
              {poison === null
                ? 'Waiting for trouble'
                : `${shuffleDown} of ${CUSTOMER_COUNT} down — just the poison one`}
            </div>
            <div className="label">
              {poison === null
                ? `16 of the ${ALL_PAIRS.length} possible combinations are in use — no two customers share both workers`
                : `${degraded(shuffle.states)} customers lost one worker (dashed) — their traffic keeps flowing on the surviving link`}
            </div>
          </div>
        </div>
      </div>
      <div className="legend">
        <span><span className="swatch" style={{ background: FAILED_COLOR }} />poison / fully down</span>
        <span><span className="swatch" style={{ background: 'transparent', border: `1.5px dashed ${FAILED_COLOR}`, borderRadius: '50%' }} />degraded (1 of 2 workers lost)</span>
        <span><span className="swatch" style={{ background: 'var(--ink-2)' }} />unaffected</span>
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className="value">{PLAIN_SHARDS} → {ALL_PAIRS.length}</div>
          <div className="label">possible shards: plain vs shuffle (C(8,2) = 28); at Route 53 scale, C(100,5) ≈ 75 million</div>
        </div>
        <div className="stat">
          <div className={`value ${poison !== null ? 'bad' : ''}`}>
            {poison === null ? '—' : `${Math.round((plainDown / CUSTOMER_COUNT) * 100)}%`}
          </div>
          <div className="label">blast radius, plain sharding (whole shard shares the poison's fate)</div>
        </div>
        <div className="stat">
          <div className={`value ${poison !== null ? 'good' : ''}`}>
            {poison === null ? '—' : `${Math.round((shuffleDown / CUSTOMER_COUNT) * 100)}%`}
          </div>
          <div className="label">blast radius, shuffle sharding (with retries, ≈ just the poison customer)</div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 1b · Shuffle sharding: the math + calculator                        */
/* ------------------------------------------------------------------ */

/** C(n, k) via the multiplicative formula — exact enough in doubles for n ≤ 500. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

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

  // Poison customer: kills all S workers of their shard. Plain sharding takes
  // the whole fixed shard's population with them; shuffle sharding takes only
  // clients whose ENTIRE combination is inside the dead set — i.e. the same combo.
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
    <div className="panel">
      <div className="controls">
        {slider('workers (N)', workers, String(workers), 4, MAX_WORKERS, 1, setWorkers, 'Number of workers')}
        {slider('shard size (S)', shardSize, String(s), 2, 8, 1, setShardSize, 'Workers per shard')}
        {slider('clients', clientExp, fmtBig(clients), 2, 7, 0.5, setClientExp, 'Number of clients (log scale)')}
      </div>
      {hotkeys && (
        <p className="preset-hint">
          <KeyHint k="1" /> Route 53 scale · <KeyHint k="2" /> small fleet · <KeyHint k="3" /> mega fleet
        </p>
      )}
      <div className="formula">
        C(N,S) = N! / (S!·(N−S)!) &nbsp;→&nbsp; C({workers},{s}) = <strong>{fmtBig(combos)}</strong> shards
        &nbsp;·&nbsp; plain N/S = <strong>{fmtBig(plainShards)}</strong>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
        aria-label={`Combinations C(N,${s}) grow to ${fmtBig(choose(MAX_WORKERS, s))} at ${MAX_WORKERS} workers while plain shards stay near ${Math.floor(MAX_WORKERS / s)}`}>
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
          <div className="label">possible shards, plain vs shuffle — the same {workers} workers, just recombined</div>
        </div>
        <div className="stat">
          <div className="value">1 in {fmtBig(combos)}</div>
          <div className="label">chance a given other client holds your exact {s}-worker combination</div>
        </div>
        <div className="stat">
          <div className="value">{othersOnMyCombo < 0.001 ? '≈ 0' : fmtCount(othersOnMyCombo).replace('≈ ', '')}</div>
          <div className="label">expected other clients (of {fmtBig(clients)}) sharing your full shard</div>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className="value bad">{fmtCount(poisonPlain)} · {fmtPct(poisonPlain / clients)}</div>
          <div className="label">poison customer, plain sharding: their whole fixed shard of clients goes down</div>
        </div>
        <div className="stat">
          <div className="value good">{fmtCount(poisonShuffle)} · {fmtPct(poisonShuffle / clients)}</div>
          <div className="label">
            poison customer, shuffle sharding: {chanceAnyOther < 0.5
              ? `only a ${fmtPct(chanceAnyOther)} chance even one other client goes down with them`
              : 'their combo-mates only — everyone else keeps at least one live worker'}
          </div>
        </div>
        <div className="stat">
          <div className="value">{fmtCount(nodeTouched)} · {fmtPct(Math.min(1, nodeTouched / clients))}</div>
          <div className="label">
            one worker dies: clients briefly degraded (they lose 1 of {s}; a retry lands on the
            other {s - 1}) — <strong>0 fully down</strong>
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
    <div className="kicker">06 · Beyond cells</div>
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
      Cells pin each customer to one partition. Shuffle sharding — the trick Route&nbsp;53 uses to
      survive DDoS attacks on individual domains — assigns each customer a random <em>subset</em>{' '}
      of workers instead. With 8 workers in plain shards of 2, there are only 4 shards, so a
      "poison" customer (one whose requests crash whatever serves them) takes their 3 shard-mates
      down with them. But there are C(8,2)&nbsp;=&nbsp;28 possible <em>combinations</em> of 2
      workers, so no two customers need to share both. Hit <strong>auto-demo</strong> and watch
      the same poison land in both worlds, over and over:
    </p>
    <ShuffleSharding />

    <p>
      Why does this get <em>better</em> as you grow? Because combinations multiply where shards
      only divide. Plain sharding gives you N/S shards; shuffle sharding gives you
      C(N,S)&nbsp;=&nbsp;N!/(S!(N−S)!) possible combinations of the <em>same workers</em> — and
      that number explodes: at shard size 5, going from 20 workers to 100 takes you from
      ~15&nbsp;thousand combinations to ~75&nbsp;million. The blast radius of a poison customer
      shrinks just as fast, because taking a second customer down requires them to share
      your <em>entire</em> combination. Run the numbers yourself:
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
