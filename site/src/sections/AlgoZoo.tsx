import React, { useContext, useEffect, useMemo, useState } from 'react';
import {
  AlgoKey,
  MAGLEV_TABLE_SIZE,
  MULTIPROBE_K,
  ZOO_INITIAL_WORKERS,
  ZOO_MAX_WORKERS,
  ZOO_MIN_WORKERS,
  ZOO_RACKS,
  ZOO_SPOTLIGHT_KEY,
  ZooSnapshot,
  buildZooRing,
  computeSnapshot,
  countChangedSlots,
  countsPerWorker,
  crushDetail,
  makeWorkers,
  movedBetween,
  multiProbeDetail,
  multiProbeWorkerPoint,
  rackMembers,
  rendezvousScore,
  workerColor,
} from '../sim/algoZoo';
import { MAX_HASH, arcPath, ownershipArcs, pointOnCircle } from '../sim/simulation';
import { SidequestOpenContext } from '../ui/Sidequest';

/**
 * The algorithm zoo's interactive card grid: six consistent-hashing
 * algorithms, ONE shared event stream. A single control row adds/removes a
 * worker from a pool every card shares (same workers, same 100 keys), and on
 * every membership change each card recomputes its own assignment and reports
 * how many keys moved — while the mod-N footer under the grid shows the naive
 * baseline reshuffling nearly everything on the identical event.
 *
 * Everything here is lazy: the demos mount and compute only once the
 * enclosing Sidequest is first expanded (SidequestOpenContext), so the
 * collapsed zoo costs nothing.
 */

/* ------------------------------------------------------------------ */
/* Shared state                                                        */
/* ------------------------------------------------------------------ */

interface ZooState {
  snap: ZooSnapshot;
  /** Snapshot before the last membership event (for diff-based visuals). */
  prev: ZooSnapshot | null;
  /** Keys moved per algorithm on the last event; null until the first event. */
  moved: Record<AlgoKey, number> | null;
  /** Maglev lookup-table slots changed on the last event. */
  slotsChanged: number | null;
  lastEvent: 'add' | 'remove' | null;
  /** Monotone event counter — keys the stat lines so the flash restarts. */
  seq: number;
}

const initialZooState = (): ZooState => ({
  snap: computeSnapshot(makeWorkers(ZOO_INITIAL_WORKERS)),
  prev: null,
  moved: null,
  slotsChanged: null,
  lastEvent: null,
  seq: 0,
});

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

const DEMO_W = 300;
const DEMO_H = 140;

const StatLine: React.FC<{ algo: AlgoKey; zs: ZooState; extra?: string }> = ({ algo, zs, extra }) => {
  const moved = zs.moved === null ? null : zs.moved[algo];
  return (
    <div
      key={zs.seq}
      className={`zoo-stat${moved === null ? ' zoo-idle' : ' zoo-flash'}`}
      data-zoo-stat={algo}
      data-moved={moved === null ? '' : moved}
    >
      {moved === null
        ? '100 keys assigned · waiting for an event'
        : `${moved} of 100 keys moved${extra ?? ''}`}
    </div>
  );
};

const svgProps = (label: string) =>
  ({
    viewBox: `0 0 ${DEMO_W} ${DEMO_H}`,
    role: 'img',
    'aria-label': label,
  }) as const;

const LABEL_FONT = 9;

/* ------------------------------------------------------------------ */
/* 1 · Classic ring + virtual nodes                                    */
/* ------------------------------------------------------------------ */

const RingDemo: React.FC<{ zs: ZooState }> = ({ zs }) => {
  const { workers } = zs.snap;
  const arcs = useMemo(() => ownershipArcs(buildZooRing(workers)), [workers]);
  const counts = countsPerWorker(zs.snap.assignments.ring, workers);
  const maxCount = Math.max(1, ...counts);
  return (
    <svg {...svgProps('Miniature hash ring: ownership arcs per worker, with per-worker key counts')}>
      {arcs.map((arc, i) => (
        <path key={i} d={arcPath(70, 70, 62, 49, arc.start, arc.end)} fill={workerColor(arc.cellId)} />
      ))}
      {workers.map((w, i) => {
        const y = 8 + i * 16;
        const width = (counts[i] / maxCount) * 78;
        return (
          <g key={w}>
            <text x={152} y={y + 8} fontSize={LABEL_FONT} fill="var(--ink-2)">
              {w}
            </text>
            <rect x={174} y={y} width={Math.max(width, 1)} height={9} rx={2} fill={workerColor(w)} />
            <text x={178 + Math.max(width, 1)} y={y + 8} fontSize={LABEL_FONT} fill="var(--muted)">
              {counts[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* 2 · Rendezvous / HRW                                                */
/* ------------------------------------------------------------------ */

const RendezvousDemo: React.FC<{ zs: ZooState }> = ({ zs }) => {
  const { workers } = zs.snap;
  const winner = zs.snap.assignments.rendezvous.get(ZOO_SPOTLIGHT_KEY);
  return (
    <svg {...svgProps(`Rendezvous scores for ${ZOO_SPOTLIGHT_KEY}: one bar per worker, highest wins`)}>
      {workers.map((w, i) => {
        const y = 8 + i * 16;
        const score = rendezvousScore(ZOO_SPOTLIGHT_KEY, w) / MAX_HASH;
        const width = 8 + score * 222;
        const isWinner = w === winner;
        return (
          <g key={w}>
            <text
              x={4}
              y={y + 8}
              fontSize={LABEL_FONT}
              fontWeight={isWinner ? 700 : 400}
              fill={isWinner ? 'var(--ink)' : 'var(--ink-2)'}
            >
              {w}
            </text>
            <rect
              x={26}
              y={y}
              width={width}
              height={9}
              rx={2}
              fill={isWinner ? workerColor(w) : 'var(--baseline)'}
            />
            {isWinner && (
              <text x={30 + width} y={y + 8} fontSize={LABEL_FONT} fontWeight={700} fill="var(--ink)">
                wins
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* 3 · Jump consistent hash                                            */
/* ------------------------------------------------------------------ */

const JumpDemo: React.FC<{ zs: ZooState }> = ({ zs }) => {
  const { workers } = zs.snap;
  const counts = countsPerWorker(zs.snap.assignments.jump, workers);
  const movedIn = zs.lastEvent === 'add' && zs.moved !== null ? zs.moved.jump : 0;
  let x = 2;
  const segments = workers.map((w, i) => {
    const width = (counts[i] / 100) * 296;
    const seg = { w, i, x, width, count: counts[i] };
    x += width;
    return seg;
  });
  const last = segments[segments.length - 1];
  return (
    <svg {...svgProps('Jump hash buckets 0..N-1 as a strip sized by key count')}>
      {movedIn > 0 && (
        <g>
          <text x={296} y={30} fontSize={LABEL_FONT} fill="var(--ink-2)" textAnchor="end">
            all {movedIn} moved keys land in the new bucket
          </text>
          <path
            d={`M ${last.x + last.width / 2} 38 v 24`}
            stroke="var(--ink-2)"
            strokeWidth={1.2}
            fill="none"
          />
        </g>
      )}
      {segments.map((s) => (
        <g key={s.w}>
          <rect x={s.x} y={66} width={Math.max(s.width - 1, 0.5)} height={34} rx={2} fill={workerColor(s.w)} />
          {s.width >= 20 && (
            <>
              <text x={s.x + s.width / 2} y={118} fontSize={LABEL_FONT} fill="var(--ink-2)" textAnchor="middle">
                {s.i}·{s.w}
              </text>
              <text x={s.x + s.width / 2} y={88} fontSize={LABEL_FONT} fontWeight={600} fill="var(--surface-1)" textAnchor="middle">
                {s.count}
              </text>
            </>
          )}
        </g>
      ))}
      <text x={2} y={135} fontSize={8} fill="var(--muted)">
        numbered buckets: grow adds {workers.length}, shrink drops {workers.length - 1}
      </text>
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* 4 · Maglev                                                          */
/* ------------------------------------------------------------------ */

const MaglevDemo: React.FC<{ zs: ZooState }> = ({ zs }) => {
  const { maglevTable } = zs.snap;
  const prevTable = zs.prev?.maglevTable ?? null;
  const slotW = 296 / MAGLEV_TABLE_SIZE;
  return (
    <svg {...svgProps(`Maglev lookup table: ${MAGLEV_TABLE_SIZE} slots colored by owning worker`)}>
      <text x={2} y={40} fontSize={LABEL_FONT} fill="var(--ink-2)">
        {MAGLEV_TABLE_SIZE}-slot lookup table (real Maglev uses 65,537)
      </text>
      {maglevTable.map((w, i) => (
        <rect key={i} x={2 + i * slotW} y={62} width={slotW} height={36} fill={workerColor(w)} />
      ))}
      {prevTable !== null &&
        zs.lastEvent !== null &&
        maglevTable.map((w, i) =>
          prevTable[i] !== w ? (
            <rect key={`c${i}`} x={2 + i * slotW} y={54} width={slotW} height={4} fill="var(--muted)" />
          ) : null
        )}
      {prevTable !== null && zs.lastEvent !== null && (
        <text x={2} y={116} fontSize={8} fill="var(--muted)">
          grey ticks mark slots whose owner changed on the last event
        </text>
      )}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* 5 · Multi-probe                                                     */
/* ------------------------------------------------------------------ */

const MultiProbeDemo: React.FC<{ zs: ZooState }> = ({ zs }) => {
  const { workers } = zs.snap;
  const detail = useMemo(() => multiProbeDetail(ZOO_SPOTLIGHT_KEY, workers), [workers]);
  const chosenProbe = detail.probes[detail.chosen];
  const cx = 70;
  const cy = 70;
  const r = 52;
  return (
    <svg {...svgProps(`Multi-probe ring: one point per worker, ${MULTIPROBE_K} probes for ${ZOO_SPOTLIGHT_KEY}, closest probe wins`)}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--baseline)" strokeWidth={2} />
      {detail.probes.map((p, i) => {
        const frac = p.position / MAX_HASH;
        const a = pointOnCircle(cx, cy, r - 7, frac);
        const b = pointOnCircle(cx, cy, r + 7, frac);
        const chosen = i === detail.chosen;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={chosen ? 'var(--ink)' : 'var(--muted)'}
            strokeWidth={chosen ? 2.4 : 1.4}
          />
        );
      })}
      {workers.map((w) => {
        const frac = multiProbeWorkerPoint(w) / MAX_HASH;
        const p = pointOnCircle(cx, cy, r, frac);
        const chosen = w === chosenProbe.worker;
        return (
          <g key={w}>
            <circle cx={p.x} cy={p.y} r={5} fill={workerColor(w)} />
            {chosen && <circle cx={p.x} cy={p.y} r={8.5} fill="none" stroke="var(--ink)" strokeWidth={1.6} />}
          </g>
        );
      })}
      <text x={148} y={56} fontSize={LABEL_FONT} fill="var(--ink-2)">
        {ZOO_SPOTLIGHT_KEY}: {MULTIPROBE_K} probes (ticks),
      </text>
      <text x={148} y={70} fontSize={LABEL_FONT} fill="var(--ink-2)">
        one point per worker (dots)
      </text>
      <circle cx={153} cy={88} r={5} fill={workerColor(chosenProbe.worker)} />
      <text x={163} y={92} fontSize={LABEL_FONT} fontWeight={700} fill="var(--ink)">
        {chosenProbe.worker} wins — nearest probe
      </text>
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* 6 · CRUSH toy sketch                                                */
/* ------------------------------------------------------------------ */

const CrushDemo: React.FC<{ zs: ZooState }> = ({ zs }) => {
  const { workers } = zs.snap;
  const racks = useMemo(() => rackMembers(workers), [workers]);
  const detail = useMemo(() => crushDetail(ZOO_SPOTLIGHT_KEY, workers), [workers]);
  const rackX = [78, 222];
  const rootX = 150;
  const rootY = 18;
  const rackY = 58;
  const workerY = 112;
  return (
    <svg {...svgProps(`CRUSH toy sketch: ${ZOO_SPOTLIGHT_KEY} descends root, then rack, then worker by straw selection`)}>
      {racks.map((members, ri) => {
        const chosenRack = ri === detail.rackIndex;
        return (
          <g key={ZOO_RACKS[ri]}>
            <path
              d={`M ${rootX} ${rootY + 6} L ${rackX[ri]} ${rackY - 9}`}
              stroke={chosenRack ? 'var(--accent)' : 'var(--baseline)'}
              strokeWidth={chosenRack ? 2.2 : 1.2}
              fill="none"
            />
            <rect
              x={rackX[ri] - 26}
              y={rackY - 9}
              width={52}
              height={18}
              rx={4}
              fill="none"
              stroke={chosenRack ? 'var(--accent)' : 'var(--baseline)'}
              strokeWidth={chosenRack ? 2 : 1.2}
            />
            <text x={rackX[ri]} y={rackY + 4} fontSize={LABEL_FONT} fill="var(--ink-2)" textAnchor="middle">
              {ZOO_RACKS[ri]}
            </text>
            {members.map((w, wi) => {
              const wx = rackX[ri] + (wi - (members.length - 1) / 2) * 30;
              const chosenWorker = chosenRack && w === detail.worker;
              return (
                <g key={w}>
                  <path
                    d={`M ${rackX[ri]} ${rackY + 9} L ${wx} ${workerY - 7}`}
                    stroke={chosenWorker ? 'var(--accent)' : 'var(--baseline)'}
                    strokeWidth={chosenWorker ? 2.2 : 1.2}
                    fill="none"
                  />
                  <circle cx={wx} cy={workerY} r={6} fill={workerColor(w)} />
                  {chosenWorker && (
                    <circle cx={wx} cy={workerY} r={9.5} fill="none" stroke="var(--accent)" strokeWidth={1.8} />
                  )}
                  <text x={wx} y={workerY + 20} fontSize={8} fill="var(--muted)" textAnchor="middle">
                    {w}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
      <circle cx={rootX} cy={rootY} r={6} fill="var(--ink-2)" />
      <text x={rootX + 11} y={rootY + 4} fontSize={LABEL_FONT} fill="var(--ink-2)">
        root · {ZOO_SPOTLIGHT_KEY} descends
      </text>
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Card copy (pros/cons preserved from the static zoo)                 */
/* ------------------------------------------------------------------ */

interface AlgoCard {
  key: Exclude<AlgoKey, 'modn'>;
  name: string;
  how: React.ReactNode;
  pros: string[];
  cons: string[];
  Demo: React.FC<{ zs: ZooState }>;
  statExtra?: (zs: ZooState) => string | undefined;
}

const CARDS: AlgoCard[] = [
  {
    key: 'ring',
    name: 'Classic hash ring',
    Demo: RingDemo,
    how: (
      <>
        Hash servers onto a circle; hash each key and walk clockwise to the next server. The one
        from <a href="#hash-ring">02 · The hash ring</a> — here with only 40 virtual nodes per
        worker so the arcs stay readable.
      </>
    ),
    pros: [
      '~1/N of keys move when a server joins or leaves',
      'weights fall out of virtual-node counts',
      'widely implemented and understood',
    ],
    cons: [
      'poor balance without virtual nodes',
      'the ring lives in memory and must be maintained',
      'virtual nodes buy balance with memory and bookkeeping',
    ],
  },
  {
    key: 'rendezvous',
    name: 'Rendezvous (HRW)',
    Demo: RendezvousDemo,
    how: (
      <>
        For every key, score every server — <code>score(server, key)</code> — and the highest
        score wins. No ring at all. The bars are the live scores for the spotlight key{' '}
        <code>{ZOO_SPOTLIGHT_KEY}</code>.
      </>
    ),
    pros: [
      'excellent balance with no virtual nodes',
      'very simple to implement',
      'only keys that prefer the new server move',
      'weighted variants are natural',
    ],
    cons: [
      'O(N) per lookup — every server gets scored',
      'gets expensive at thousands of nodes',
    ],
  },
  {
    key: 'jump',
    name: 'Jump consistent hash',
    Demo: JumpDemo,
    how: (
      <>
        A pure function from <code>(key, bucket count)</code> to a bucket number. No ring, no
        table, no state. The catch: buckets are just numbers, so a worker can only be removed
        from the end — which is exactly why the shared controls above always remove the
        last-added worker.
      </>
    ),
    pros: [
      'O(1) lookup, zero memory',
      'excellent distribution, minimal key movement',
      'extremely fast — a few multiplies',
    ],
    cons: [
      'buckets must be numbered 0..N−1, so you can only shrink from the end',
      'no weighted nodes in the basic algorithm',
    ],
  },
  {
    key: 'maglev',
    name: 'Maglev',
    Demo: MaglevDemo,
    statExtra: (zs) =>
      zs.slotsChanged === null ? undefined : ` · ${zs.slotsChanged} of ${MAGLEV_TABLE_SIZE} table slots changed`,
    how: (
      <>
        Precompute a lookup table mapping hash values straight to servers — Google's
        load-balancer design. The strip is the real table, rebuilt on every membership change.
      </>
    ),
    pros: [
      'O(1) lookup with excellent cache locality',
      'excellent distribution',
      'minimal remapping on change',
    ],
    cons: [
      'the table must be rebuilt whenever membership changes',
      'the table costs real memory',
    ],
  },
  {
    key: 'multiprobe',
    name: 'Multi-probe',
    Demo: MultiProbeDemo,
    how: (
      <>
        A small ring with no virtual nodes: each worker owns one point, each key is probed{' '}
        {MULTIPROBE_K} times, and the probe that lands closest to a worker point decides — probes
        buy the balance vnodes would.
      </>
    ),
    pros: [
      'good balance',
      'far less memory than virtual-node rings',
      'minimal remapping',
    ],
    cons: [
      'more complex to implement',
      'each lookup pays for k probes — slightly slower',
    ],
  },
  {
    key: 'crush',
    name: 'CRUSH — toy sketch',
    Demo: CrushDemo,
    how: (
      <>
        Walks a topology tree — here just two racks of workers — choosing a placement at each
        level with simplified straw selection (straw2's shape). Ceph's real engine adds deeper
        hierarchies, device weights, and replica policies.
      </>
    ),
    pros: [
      'fault-aware placement across failure domains',
      'flexible replication policies',
      'scales to very large storage clusters',
    ],
    cons: [
      'much more complex than anything else here',
      'overkill unless you are building a storage system',
    ],
  },
];

/* ------------------------------------------------------------------ */
/* The zoo grid + shared controls                                      */
/* ------------------------------------------------------------------ */

const AlgoZoo: React.FC = () => {
  const open = useContext(SidequestOpenContext);
  const [zs, setZs] = useState<ZooState | null>(null);

  // Lazy: compute the first snapshot only when the sidequest first expands.
  useEffect(() => {
    if (open) setZs((cur) => cur ?? initialZooState());
  }, [open]);

  const change = (delta: 1 | -1) =>
    setZs((cur) => {
      if (!cur) return cur;
      const n = cur.snap.workers.length + delta;
      if (n < ZOO_MIN_WORKERS || n > ZOO_MAX_WORKERS) return cur;
      const snap = computeSnapshot(makeWorkers(n));
      return {
        snap,
        prev: cur.snap,
        moved: movedBetween(cur.snap, snap),
        slotsChanged: countChangedSlots(cur.snap.maglevTable, snap.maglevTable),
        lastEvent: delta > 0 ? 'add' : 'remove',
        seq: cur.seq + 1,
      };
    });

  const nWorkers = zs?.snap.workers.length ?? ZOO_INITIAL_WORKERS;

  return (
    <>
      <div className="zoo-controls" role="group" aria-label="Shared worker pool for all six demos">
        <button type="button" className="primary" onClick={() => change(1)} disabled={!zs || nWorkers >= ZOO_MAX_WORKERS}>
          Add a worker
        </button>
        <button type="button" onClick={() => change(-1)} disabled={!zs || nWorkers <= ZOO_MIN_WORKERS}>
          Remove a worker
        </button>
        <button type="button" onClick={() => setZs(initialZooState())} disabled={!zs}>
          Reset
        </button>
        <span className="zoo-count" data-zoo-workers={nWorkers}>
          {zs &&
            zs.snap.workers.map((w) => (
              <span key={w} className="zoo-legend-item">
                <span className="zoo-dot" style={{ background: workerColor(w) }} />
                {w}
              </span>
            ))}
          <span className="zoo-count-text">
            {nWorkers} workers · the same 100 keys for every card
          </span>
        </span>
      </div>
      <p className="zoo-note">
        One event, six answers: every button press changes the SAME worker pool under all six
        algorithms at once, and each card reports how many of the same 100 keys it had to move.
        Removal always takes the last-added worker because jump hash can only shrink from the end
        — the others could drop any worker, but giving all six the identical event is what keeps
        the comparison honest.
      </p>
      <div className="algo-grid">
        {CARDS.map((card) => (
          <div key={card.key} className="panel algo-card" data-zoo-card={card.key}>
            <h3>{card.name}</h3>
            <div className="zoo-demo">{zs ? <card.Demo zs={zs} /> : <div className="zoo-demo-placeholder" />}</div>
            {zs && <StatLine algo={card.key} zs={zs} extra={card.statExtra?.(zs)} />}
            <p className="algo-how">{card.how}</p>
            <ul className="algo-pros">
              {card.pros.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <ul className="algo-cons">
              {card.cons.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div
        className={`zoo-footer${zs && zs.moved !== null ? ' zoo-footer-hot' : ''}`}
        data-zoo-stat="modn"
        data-moved={zs && zs.moved !== null ? zs.moved.modn : ''}
      >
        <span className="zoo-footer-label">
          The control group, naive <code>hash&nbsp;%&nbsp;N</code>:
        </span>{' '}
        {zs && zs.moved !== null ? (
          <strong key={zs.seq} className="zoo-flash">
            {zs.moved.modn} of the same 100 keys moved
          </strong>
        ) : (
          <span>waiting for the same event</span>
        )}{' '}
        — the cliff from the scaling table below, measured live on the identical membership
        change.
      </div>
    </>
  );
};

export default AlgoZoo;
