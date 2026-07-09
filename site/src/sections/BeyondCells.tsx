import React, { useMemo, useState } from 'react';
import { hashKey, CELL_COLOR_VARS, FAILED_COLOR } from '../sim/simulation';

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

function shardImpact(pairs: Pair[], poison: number | null) {
  const deadWorkers = new Set<number>(poison === null ? [] : pairs[poison]);
  const states: CustomerState[] = pairs.map((p, i) => {
    if (i === poison) return 'poison';
    const hits = p.filter((w) => deadWorkers.has(w)).length;
    return hits === p.length ? 'down' : hits > 0 ? 'degraded' : 'fine';
  });
  return { deadWorkers, states };
}

const ShuffleSharding: React.FC = () => {
  const [poison, setPoison] = useState<number | null>(null);

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
        {/* workers */}
        {Array.from({ length: WORKER_COUNT }, (_, w) => {
          const dead = deadWorkers.has(w);
          return (
            <g key={w}>
              <rect x={workerBoxX(w)} y={26} width={44} height={26} rx={5} fill={workerColor(w)} />
              <text x={workerCX(w)} y={43} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff">
                {dead ? '✗ ' : ''}W{w + 1}
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
              onClick={() => setPoison(poison === i ? null : i)}
              style={{ cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setPoison(poison === i ? null : i);
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
                <text x={custCX(i)} y={CUST_Y + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">
                  ☠
                </text>
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
        <strong>Same 8 workers, same poison customer — two ways to slice them.</strong>
        <span style={{ flex: 1 }} />
        {poison !== null && <button onClick={() => setPoison(null)}>Cure the poison</button>}
      </div>
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
                : `${degraded(shuffle.states)} customers lost one worker (dashed) — a retry against their other worker still succeeds`}
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
/* 2 · Static stability                                                */
/* ------------------------------------------------------------------ */

const AZ_NAMES = ['us-east-1a', 'us-east-1b', 'us-east-1c'];
const DEMAND = 100; // all capacity numbers are % of demand
const HOT_PER_AZ = 34; // ≈ demand ÷ 3
const STATIC_PER_AZ = 50; // demand ÷ (3 − 1)
const METER_MAX = 160;
const USER_DOTS = 30;

const StaticStability: React.FC = () => {
  const [strategy, setStrategy] = useState<'hot' | 'static'>('hot');
  const [lost, setLost] = useState(false);

  const perAz = strategy === 'hot' ? HOT_PER_AZ : STATIC_PER_AZ;
  const liveAzs = lost ? AZ_NAMES.length - 1 : AZ_NAMES.length;
  const surviving = perAz * liveAzs;
  const shortfall = Math.max(0, DEMAND - surviving);
  const shed = Math.round((shortfall / DEMAND) * USER_DOTS);

  const pct = (v: number) => `${(v / METER_MAX) * 100}%`;

  return (
    <div className="panel">
      <div className="controls">
        <button
          className={strategy === 'hot' ? 'selected' : ''}
          onClick={() => setStrategy('hot')}
        >
          Run hot — {HOT_PER_AZ}% per AZ
        </button>
        <button
          className={strategy === 'static' ? 'selected' : ''}
          onClick={() => setStrategy('static')}
        >
          Statically stable — {STATIC_PER_AZ}% per AZ
        </button>
        <span style={{ flex: 1 }} />
        {!lost ? (
          <button className="danger" onClick={() => setLost(true)}>💥 Lose an AZ</button>
        ) : (
          <button onClick={() => setLost(false)}>Recover the AZ</button>
        )}
      </div>
      <div className="az-row">
        {AZ_NAMES.map((name, i) => {
          const down = lost && i === AZ_NAMES.length - 1;
          return (
            <div key={name} className={`az-card${down ? ' down' : ''}`}>
              <div className="name" style={{ color: down ? 'var(--critical)' : 'var(--ink)' }}>
                {down ? '✗ ' : ''}{name}{down ? ' — offline' : ''}
              </div>
              <div className="prov">
                {down ? `${perAz}% of demand, unreachable` : `running ${perAz}% of demand`}
              </div>
              <div className="az-bar">
                <div
                  className="fill"
                  style={{
                    width: `${down ? 0 : (perAz / STATIC_PER_AZ) * 100}%`,
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
          <span>capacity running right now</span>
          <span>demand = {DEMAND}%</span>
        </div>
        <div
          className="meter"
          role="img"
          aria-label={`${surviving}% of demand running, demand is ${DEMAND}%${shortfall > 0 ? `, ${shortfall}% shortfall` : ''}`}
        >
          <div className="fill-ok" style={{ width: pct(Math.min(surviving, DEMAND)) }} />
          {surviving > DEMAND && (
            <div className="fill-extra" style={{ left: pct(DEMAND), width: pct(surviving - DEMAND) }} />
          )}
          {shortfall > 0 && (
            <div className="fill-gap" style={{ left: pct(surviving), width: pct(shortfall) }} />
          )}
          <div className="demand-line" style={{ left: pct(DEMAND) }} />
        </div>
      </div>
      {lost && (
        <p style={{ margin: '0.9rem 0 0' }}>
          {strategy === 'hot' ? (
            <span className="pulse-chip">
              ⏳ shortfall: {shortfall}% — asking the EC2 control plane for more capacity, along
              with everyone else in the region…
            </span>
          ) : (
            <span className="pulse-chip calm">
              ✓ nothing to do — the replacement capacity was already running
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
          <div className={`value ${lost ? (surviving >= DEMAND ? 'good' : 'bad') : ''}`}>{surviving}%</div>
          <div className="label">
            capacity {lost ? 'surviving the AZ loss' : 'running'} vs demand of {DEMAND}%
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
          <div className="value">{perAz * AZ_NAMES.length}%</div>
          <div className="label">total capacity you pay for on a normal day — static stability isn't free</div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 3 · Constant work                                                   */
/* ------------------------------------------------------------------ */

const TICKS = 24;
const TABLE_SIZE = 48; // rows in the full health-check table
const DELTA_CAPACITY = 12; // updates/tick the delta pipeline is provisioned for
const STORM_START = 9;
const STORM_END = 15;

/** Quiet-day change rate: 1–3 changes per tick, seeded so it never shifts. */
const quietChanges = (t: number) => 1 + (hashKey(`beyond-tick-${t}`) % 3);

const ConstantWork: React.FC = () => {
  const [storm, setStorm] = useState(false);
  const [intensity, setIntensity] = useState(36);

  const sim = useMemo(() => {
    const changes = Array.from({ length: TICKS }, (_, t) =>
      quietChanges(t) + (storm && t >= STORM_START && t <= STORM_END ? intensity : 0)
    );
    let backlog = 0;
    for (const c of changes) backlog = Math.max(0, backlog + c - DELTA_CAPACITY);
    // How long past the window the delta pipeline needs to drain the queue.
    let drainTicks = 0;
    for (let b = backlog, t = TICKS; b > 0 && drainTicks < 500; t++, drainTicks++) {
      b = Math.max(0, b + quietChanges(t) - DELTA_CAPACITY);
    }
    const peak = Math.max(...changes);
    const quietAvg =
      Array.from({ length: TICKS }, (_, t) => quietChanges(t)).reduce((a, b) => a + b, 0) / TICKS;
    return { changes, backlog, drainTicks, peak, quietAvg };
  }, [storm, intensity]);

  const W = 420;
  const H = 150;
  const PAD_T = 16;
  const PAD_B = 18;
  const yMax = Math.max(TABLE_SIZE, sim.peak) * 1.1;
  const y = (v: number) => H - PAD_B - (v / yMax) * (H - PAD_B - PAD_T);
  const bw = W / TICKS;

  const stormShade = storm && (
    <rect
      x={STORM_START * bw}
      y={PAD_T}
      width={(STORM_END - STORM_START + 1) * bw}
      height={H - PAD_T - PAD_B}
      fill={FAILED_COLOR}
      opacity={0.08}
    />
  );

  const axis = (
    <>
      <line x1={0} y1={H - PAD_B} x2={W} y2={H - PAD_B} stroke="var(--grid)" />
      <text x={W - 4} y={H - 6} textAnchor="end" fontSize={9} fill="var(--muted)">
        time →
      </text>
      {storm && (
        <text x={(STORM_START + (STORM_END - STORM_START + 1) / 2) * bw} y={H - 6} textAnchor="middle" fontSize={9} fill={FAILED_COLOR}>
          storm
        </text>
      )}
    </>
  );

  return (
    <div className="panel">
      <div className="controls">
        <button className={!storm ? 'selected' : ''} onClick={() => setStorm(false)}>
          Quiet day
        </button>
        <button className={storm ? 'selected' : ''} onClick={() => setStorm(true)}>
          🌩️ Storm
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 220px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-2)' }}>storm size</span>
          <input
            type="range"
            min={8}
            max={48}
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
          <div className="mini-title">Delta-based — work per change</div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
            aria-label={`Delta pipeline work per tick; peak ${sim.peak} against a capacity of ${DELTA_CAPACITY}`}>
            {stormShade}
            {sim.changes.map((c, t) => {
              const within = Math.min(c, DELTA_CAPACITY);
              const over = c - within;
              return (
                <g key={t}>
                  <rect x={t * bw + 2} y={y(within)} width={bw - 4} height={y(0) - y(within)} fill="var(--cell-1)" />
                  {over > 0 && (
                    <rect x={t * bw + 2} y={y(c)} width={bw - 4} height={y(within) - y(c)} fill={FAILED_COLOR} />
                  )}
                </g>
              );
            })}
            <line x1={0} y1={y(DELTA_CAPACITY)} x2={W} y2={y(DELTA_CAPACITY)} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="5 4" />
            <text x={4} y={y(DELTA_CAPACITY) - 4} fontSize={9.5} fill="var(--ink-2)">
              provisioned capacity: {DELTA_CAPACITY}/tick
            </text>
            {sim.backlog > 0 && (
              <text x={W - 4} y={PAD_T - 4} textAnchor="end" fontSize={11} fontWeight={700} fill={FAILED_COLOR}>
                queue: {sim.backlog} updates behind
              </text>
            )}
            {axis}
          </svg>
          <div className="stat">
            <div className={`value ${sim.backlog > 0 ? 'bad' : ''}`} style={{ fontSize: '1.1rem' }}>
              {sim.backlog > 0
                ? `${sim.backlog} behind — ${sim.drainTicks} ticks to catch up`
                : 'Keeping up (barely doing anything)'}
            </div>
            <div className="label">
              {sim.backlog > 0
                ? 'the red overflow is work it can\'t do in time — health updates lag during the exact storm they exist to report'
                : 'cheap on a quiet day; the storm path is the one path that never gets exercised'}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <div className="mini-title">Constant work — push the full table every tick</div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
            aria-label={`Constant-work pipeline: ${TABLE_SIZE} units every tick regardless of storm`}>
            {stormShade}
            {sim.changes.map((_, t) => (
              <rect key={t} x={t * bw + 2} y={y(TABLE_SIZE)} width={bw - 4} height={y(0) - y(TABLE_SIZE)} fill="var(--cell-2)" />
            ))}
            <text x={4} y={y(TABLE_SIZE) - 4} fontSize={9.5} fill="var(--ink-2)">
              full {TABLE_SIZE}-row table, every tick
            </text>
            {axis}
          </svg>
          <div className="stat">
            <div className="value good" style={{ fontSize: '1.1rem' }}>
              {storm ? 'The chart did not move' : `${TABLE_SIZE} units, every single tick`}
            </div>
            <div className="label">
              {storm
                ? `${intensity} simultaneous changes cost exactly the same as 1 — they're just different values in the same table push`
                : 'looks wasteful on a quiet day; that "waste" is a rehearsal for the storm'}
            </div>
          </div>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className={`value ${storm ? 'bad' : ''}`}>
            {storm ? `${Math.round(sim.peak / sim.quietAvg)}×` : '1×'}
          </div>
          <div className="label">delta pipeline: peak work vs a quiet tick (avg {sim.quietAvg.toFixed(1)} changes/tick)</div>
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
      workers, so no two customers need to share both. Click a customer below and compare worlds:
    </p>
    <ShuffleSharding />

    <h3>Static stability: pay for the failure before it happens</h3>
    <p>
      A statically stable system survives a dependency failure <em>without changing anything at
      failure time</em> — no scale-up, no control-plane calls, no reconfiguration in the critical
      moment. The canonical example: run three availability zones at 50% of demand each, so losing
      one leaves 2&nbsp;×&nbsp;50% = 100% already serving. The tempting alternative — run hot at
      ~33% each and scale up reactively — needs the EC2 control plane at the exact moment an
      AZ-wide event has every other customer asking it for the same instances. Rule of thumb: the
      data plane must not depend on the control plane during recovery.
    </p>
    <StaticStability />

    <h3>Constant work: make the busy path the only path</h3>
    <p>
      Most systems do work proportional to how much is changing — cheap when calm, overwhelmed
      exactly during the storm. That's <em>bimodal</em> behavior, and the failure mode is
      correlated with the moment you can least afford it. The constant-work alternative, from
      Route&nbsp;53's health-check aggregators: push the <em>entire</em> table every few seconds,
      whether 1 row changed or 1,000. No modes, nothing to queue, and the busy-day path gets
      exercised every quiet day too — the mise en place is prepped every morning, so the rush
      can't surprise you.
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
