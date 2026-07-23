import React, { useMemo, useState } from 'react';
import { assign, buildRing, cellColor, clientIds, countMoved, hashKey, makeCells, CELL_COLOR_VARS, CELL_NAMES } from '../sim/simulation';
import TryLive from '../TryLive';
import KeyHint, { useHotkeys } from '../ui/KeyHint';
import Sidequest from '../ui/Sidequest';

const CLIENT_COUNT = 400;
const MIN_CELLS = 2;
const MAX_CELLS = 8;

/** The add-or-remove-a-cell movement demo — used by the section below and the slide deck. */
export const ScaleDemo: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  // Track the previous slider value so the stats describe the transition the
  // reader actually made — growing OR shrinking — not a fixed baseline.
  const [counts, setCounts] = useState({ prev: 3, curr: 4 });

  const changeCells = (next: number) =>
    setCounts((s) => (next === s.curr ? s : { prev: s.curr, curr: next }));

  // Presenter keys (slide deck only): A adds a cell, X removes one
  useHotkeys(hotkeys, {
    a: () => setCounts((s) => (s.curr >= MAX_CELLS ? s : { prev: s.curr, curr: s.curr + 1 })),
    x: () => setCounts((s) => (s.curr <= MIN_CELLS ? s : { prev: s.curr, curr: s.curr - 1 })),
  });
  const clients = useMemo(() => clientIds(CLIENT_COUNT), []);

  const { prev, curr } = counts;
  const growing = curr > prev;

  // % of clients that move across the prev→curr transition, both strategies,
  // computed with the real ring in both directions — never approximated.
  const moved = useMemo(() => {
    const before = assign(clients, buildRing(makeCells(prev)));
    const after = assign(clients, buildRing(makeCells(curr)));
    const consistentMoved = countMoved(before, after);

    let moduloMoved = 0;
    for (const id of clients) {
      if (hashKey(id) % prev !== hashKey(id) % curr) moduloMoved++;
    }

    return {
      consistent: (consistentMoved / CLIENT_COUNT) * 100,
      modulo: (moduloMoved / CLIENT_COUNT) * 100,
      // Growing n→m: the new cells claim ≈(m−n)/m of the keyspace.
      // Shrinking n→m: the removed cells' ≈(n−m)/n of clients remap.
      ideal: (Math.abs(curr - prev) / Math.max(prev, curr)) * 100,
    };
  }, [prev, curr, clients]);

  const cellsNow = useMemo(() => makeCells(curr), [curr]);
  const regions = useMemo(() => {
    const map = new Map<string, typeof cellsNow>();
    for (const c of cellsNow) {
      if (!map.has(c.region)) map.set(c.region, []);
      map.get(c.region)!.push(c);
    }
    return [...map.entries()];
  }, [cellsNow]);

  return (
    <div className="panel">
        <div className="controls">
          <label data-testid="scale-transition">
            {growing ? 'Grew' : 'Shrank'} from <strong>{prev}</strong> to <strong>{curr}</strong>{' '}
            cells
            {hotkeys && <> <KeyHint k="A" />+<KeyHint k="X" />−</>}
          </label>
          <input
            type="range"
            min={MIN_CELLS}
            max={MAX_CELLS}
            value={curr}
            onChange={(e) => changeCells(Number(e.target.value))}
            style={{ flex: '1 1 200px' }}
            aria-label="Number of cells"
          />
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className="value good" data-testid="scale-consistent">{moved.consistent.toFixed(0)}%</div>
            <div className="label" data-testid="scale-consistent-label">
              clients moved when {growing ? 'growing' : 'shrinking'} {prev}→{curr} — consistent
              hashing (ideal ≈ {moved.ideal.toFixed(0)}%)
            </div>
          </div>
          <div className="stat">
            <div className="value bad" data-testid="scale-modulo">{moved.modulo.toFixed(0)}%</div>
            <div className="label" data-testid="scale-modulo-label">
              clients moved when {growing ? 'growing' : 'shrinking'} {prev}→{curr} — naive
              hash&nbsp;mod&nbsp;N
            </div>
          </div>
        </div>
        <p
          style={{ fontSize: '0.9rem', color: 'var(--muted)', margin: '0.75rem 0 0' }}
          data-testid="scale-direction-note"
          role="status"
        >
          {growing ? (
            <>
              The {curr - prev === 1 ? 'new cell claims' : 'new cells claim'} ≈
              {moved.ideal.toFixed(0)}% of the keyspace — a thin sliver from every existing cell —
              and only those clients move. Mod-N renumbers nearly everyone.
            </>
          ) : (
            <>
              Only the {prev - curr === 1 ? "removed cell's" : "removed cells'"} ≈
              {moved.ideal.toFixed(0)}% of clients remap onto the survivors — which is why
              draining a cell for a deploy or maintenance is cheap. Mod-N reshuffles nearly
              everyone either way.
            </>
          )}
        </p>
        <h3 style={{ margin: '1.5rem 0 0.5rem', fontSize: '1rem' }}>Where the cells live</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--ink-2)', marginTop: 0 }}>
          Cells are placed across regions and availability zones, so a whole-AZ or whole-region
          event still only takes out the cells inside it. The router is the only global piece.
        </p>
        <svg width="100%" viewBox="0 0 640 210" role="img" aria-label="Topology: router above cells grouped by region and availability zone">
          <rect x={220} y={8} width={200} height={34} rx={8} fill="none" stroke="var(--baseline)" />
          <text x={320} y={30} textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight={600}>
            Thin routing layer
          </text>
          {regions.map(([region, regionCells], ri) => {
            const rx = 20 + ri * 310;
            return (
              <g key={region}>
                <rect x={rx} y={70} width={290} height={130} rx={10} fill="none" stroke="var(--grid)" />
                <text x={rx + 12} y={90} fill="var(--muted)" fontSize="11">
                  {region}
                </text>
                {regionCells.map((cell, ci) => {
                  const cx = rx + 14 + (ci % 2) * 140;
                  const cy = 100 + Math.floor(ci / 2) * 48;
                  return (
                    <g key={cell.cellId}>
                      <line x1={320} y1={42} x2={cx + 62} y2={cy} stroke="var(--grid)" strokeWidth={1} />
                      <rect x={cx} y={cy} width={124} height={36} rx={6} fill={cellColor(cell.cellId)} />
                      <text x={cx + 62} y={cy + 15} textAnchor="middle" fill="#fff" fontSize="11" fontWeight={600}>
                        {cell.cellId}
                      </text>
                      <text x={cx + 62} y={cy + 28} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="9">
                        {cell.availabilityZone}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Sidequest: hydrating a cell — three small pattern diagrams.         */
/* Visual dialect follows the primer's IsolationStepper: thin strokes, */
/* solid = owned state, dashed = async/event traffic.                  */
/* ------------------------------------------------------------------ */

const LazyDiagram: React.FC = () => (
  <svg viewBox="0 0 300 120" role="img"
    aria-label="Lazy hydration: the client's first request misses the new cell's local store, which pulls the slice from the system of record and serves">
    {/* client → cell request */}
    <circle cx={20} cy={40} r={6} fill="var(--ink)" />
    <text x={20} y={60} textAnchor="middle" fontSize={9} fill="var(--muted)">client</text>
    <path d="M 30 40 H 58" stroke="var(--baseline)" strokeWidth={1.4} fill="none" />
    <path d="M 54 36 l 6 4 -6 4" stroke="var(--baseline)" strokeWidth={1.4} fill="none" />
    {/* the new cell */}
    <rect x={64} y={12} width={110} height={82} rx={7} fill="var(--surface-1)"
      stroke={CELL_COLOR_VARS[1]} strokeWidth={1.6} />
    <text x={119} y={28} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--ink)">new cell</text>
    <rect x={77} y={38} width={84} height={20} rx={4} fill={CELL_COLOR_VARS[1]} />
    <text x={119} y={51.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="#fff">local store</text>
    <text x={119} y={74} textAnchor="middle" fontSize={8.5} fill="var(--muted)">miss → pull → write</text>
    <text x={119} y={86} textAnchor="middle" fontSize={8.5} fill="var(--muted)">→ serve</text>
    {/* dashed pull from the system of record */}
    <rect x={212} y={26} width={80} height={46} rx={7} fill="none" stroke="var(--baseline)" strokeWidth={1.4} />
    <text x={252} y={45} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">system of</text>
    <text x={252} y={57} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">record</text>
    <path d="M 208 49 H 178" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="4 4" fill="none" />
    <path d="M 184 45 l -6 4 6 4" stroke="var(--accent)" strokeWidth={1.3} fill="none" />
    <text x={193} y={40} textAnchor="middle" fontSize={8.5} fill="var(--accent)">pull on miss</text>
    <text x={150} y={112} textAnchor="middle" fontSize={9} fill="var(--muted)">
      first request pays the fetch — put-if-absent makes retries safe
    </text>
  </svg>
);

const PreHydrationDiagram: React.FC = () => (
  <svg viewBox="0 0 300 120" role="img"
    aria-label="Pre-hydration: a backfill bulk-copies the slice from the system of record into the new cell, and the router flips only after a readiness check passes">
    {/* router, gated on readiness */}
    <rect x={60} y={6} width={232} height={20} rx={5} fill="var(--surface-1)"
      stroke="var(--baseline)" strokeWidth={1.4} />
    <text x={176} y={19.5} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">
      router — flips when hydration is complete
    </text>
    {/* system of record */}
    <rect x={8} y={46} width={84} height={48} rx={7} fill="none" stroke="var(--baseline)" strokeWidth={1.4} />
    <text x={50} y={66} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">system of</text>
    <text x={50} y={78} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">record</text>
    {/* batch backfill arrows */}
    {[58, 70, 82].map((y) => (
      <g key={y}>
        <path d={`M 96 ${y} H 190`} stroke={CELL_COLOR_VARS[2]} strokeWidth={1.4} fill="none" />
        <path d={`M 186 ${y - 4} l 6 4 -6 4`} stroke={CELL_COLOR_VARS[2]} strokeWidth={1.4} fill="none" />
      </g>
    ))}
    <text x={143} y={50} textAnchor="middle" fontSize={8.5} fill="var(--muted)">backfill (re-runnable)</text>
    {/* the new cell */}
    <rect x={196} y={40} width={96} height={62} rx={7} fill="var(--surface-1)"
      stroke={CELL_COLOR_VARS[2]} strokeWidth={1.6} />
    <text x={244} y={56} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--ink)">new cell</text>
    <rect x={210} y={64} width={68} height={20} rx={4} fill={CELL_COLOR_VARS[2]} />
    <text x={244} y={77.5} textAnchor="middle" fontSize={9} fontWeight={600} fill="#fff">store</text>
    {/* readiness signal up to the router */}
    <path d="M 244 40 V 28" stroke="var(--good)" strokeWidth={1.3} strokeDasharray="4 4" fill="none" />
    <text x={252} y={36} fontSize={8.5} fill="var(--good)" fontWeight={600}>ready ✓</text>
    <text x={150} y={114} textAnchor="middle" fontSize={9} fill="var(--muted)">
      copy first, cut over second — reruns converge
    </text>
  </svg>
);

const CdcDiagram: React.FC = () => (
  <svg viewBox="0 0 300 120" role="img"
    aria-label="Continuous sync: the system of record streams changes to every cell, and each cell dedupes replays through an idempotency store">
    {/* system of record */}
    <rect x={8} y={36} width={84} height={48} rx={7} fill="none" stroke="var(--baseline)" strokeWidth={1.4} />
    <text x={50} y={56} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">system of</text>
    <text x={50} y={68} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">record</text>
    {/* dashed event stream fanning out */}
    <path d="M 96 52 C 140 44, 150 34, 184 30" stroke="var(--accent)" strokeWidth={1.3}
      strokeDasharray="4 4" fill="none" />
    <path d="M 178 26 l 7 4 -7 3" stroke="var(--accent)" strokeWidth={1.3} fill="none" />
    <path d="M 96 68 C 140 76, 150 86, 184 90" stroke="var(--accent)" strokeWidth={1.3}
      strokeDasharray="4 4" fill="none" />
    <path d="M 178 86 l 7 4 -7 3" stroke="var(--accent)" strokeWidth={1.3} fill="none" />
    <text x={140} y={56} textAnchor="middle" fontSize={8.5} fill="var(--accent)">changes,</text>
    <text x={140} y={67} textAnchor="middle" fontSize={8.5} fill="var(--accent)">at-least-once</text>
    {/* two consuming cells with idempotency stores */}
    {[0, 1].map((i) => {
      const y = i === 0 ? 6 : 64;
      return (
        <g key={i}>
          <rect x={190} y={y} width={102} height={50} rx={7} fill="var(--surface-1)"
            stroke={CELL_COLOR_VARS[i]} strokeWidth={1.6} />
          <text x={241} y={y + 14} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--ink)">
            cell {'AB'[i]} · own clients
          </text>
          <rect x={198} y={y + 22} width={86} height={18} rx={4} fill={CELL_COLOR_VARS[i]} />
          <text x={241} y={y + 34.5} textAnchor="middle" fontSize={7.5} fontWeight={600} fill="#fff">
            idempotency store
          </text>
        </g>
      );
    })}
    <text x={95} y={110} textAnchor="middle" fontSize={9} fill="var(--muted)">
      replayed event → stored answer
    </text>
  </svg>
);

interface HydrationPattern {
  title: string;
  body: React.ReactNode;
  tradeoff: React.ReactNode;
  diagram: React.ReactNode;
}

const HYDRATION_PATTERNS: HydrationPattern[] = [
  {
    title: '1 · Lazy hydration — read-through on first touch',
    body: (
      <>
        The first request in the new cell misses the local store, so the cell pulls that
        client's slice from the system of record, writes it locally, and serves. It's naturally
        idempotent — a fetch plus a put-if-absent — and needs zero pre-work: nothing happens for
        clients who never show up. But the first request pays the fetch latency, and the system
        of record must be reachable at exactly that moment.
      </>
    ),
    tradeoff: (
      <>
        Trade-off: a mass remap becomes a thundering herd of cold reads against the system of
        record.
      </>
    ),
    diagram: <LazyDiagram />,
  },
  {
    title: '2 · Pre-hydration — backfill before cutover',
    body: (
      <>
        The assignment change kicks off a pipeline that bulk-copies the client's slice into the
        target cell <em>before</em> the router flips — readiness means "hydration complete", the
        same idea as ARC's readiness checks in{' '}
        <a href="#sidequest-registry">the registry sidequest</a>. Replays are expected: backfill
        jobs die halfway and rerun, so every write must be conditional or versioned, letting a
        second pass converge on the same state instead of corrupting it.
      </>
    ),
    tradeoff: (
      <>
        Trade-off: no cold first request, but remaps stop being instant — cutover waits on a
        pipeline.
      </>
    ),
    diagram: <PreHydrationDiagram />,
  },
  {
    title: '3 · Continuous sync — CDC / event stream',
    body: (
      <>
        The system of record streams every change (DynamoDB Streams, Debezium, an event bus)
        and each cell consumes only its clients' events, so the new cell is already warm when a
        client lands. Stream delivery is at-least-once by construction, so consumers make it
        effectively exactly-once: an idempotency key per event, with results kept in a
        persistent store under a TTL. That's exactly what{' '}
        <a
          href="https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powertools for AWS Lambda (Python)
        </a>{' '}
        ships as its Idempotency utility — wrap the handler, it hashes the payload, stores the
        result in DynamoDB, and a replayed event returns the stored answer instead of
        re-executing.
      </>
    ),
    tradeoff: (
      <>
        Trade-off: cells are always warm, but the pipeline is always on — running and costing
        money even when nobody remaps.
      </>
    ),
    diagram: <CdcDiagram />,
  },
];

const Scale: React.FC = () => {
  return (
    <section className="lesson" id="scale">
      <div className="kicker">06 · Elasticity</div>
      <h2>Scale out by adding cells</h2>
      <p>
        Capacity management becomes cookie-cutter: need more headroom, stamp out another cell.
        When a new cell joins the ring it claims a proportional slice of the keyspace, taking a
        thin sliver from every existing cell. And the same math runs in reverse: drain a cell for
        maintenance or remove one after the rush, and only that cell's clients remap onto the
        survivors. Drag the slider both ways and compare how much traffic moves under consistent
        hashing versus the naive <code>hash mod N</code> approach:
      </p>
      <ScaleDemo />
      <div className="callout">
        <strong>Cells also cap other risks:</strong> deployments roll cell-by-cell (a bad release
        hits one cell, not the fleet), load tests validate one cell's known capacity, and a
        "poison" customer who triggers a crash loop only takes down the cell they hash to.
      </div>
      <Sidequest
        id="sidequest-hydration"
        title="Hydrating a cell: how the data follows the client"
        blurb={
          <>
            Routing moves a client to a new cell in one hash lookup — but their data doesn't
            teleport. Every real cell system needs a hydration story: how state reaches the cell
            that now owns the client, and why every step of it must be idempotent.
          </>
        }
      >
        <p>
          The system of record lives downstream of the cells — a central database, a data lake,
          an event log. Each cell holds a working copy of just its clients' slice, so when the
          ring remaps a client, that slice has to reach the new owner. Three patterns cover most
          real systems:
        </p>
        {HYDRATION_PATTERNS.map((p) => (
          <div className="hydration-card" key={p.title}>
            <div className="text">
              <h4>{p.title}</h4>
              <p>{p.body}</p>
              <p className="tradeoff">{p.tradeoff}</p>
            </div>
            {p.diagram}
          </div>
        ))}
        <p>
          Whichever pattern you pick, the rule is the same: hydration <strong>will</strong>{' '}
          retry, so every write must be safe to repeat — conditional writes, version checks, or
          an idempotency layer. Never a bare append.
        </p>
      </Sidequest>
      <TryLive>Toggle whole regions on and off in the live admin dashboard</TryLive>
    </section>
  );
};

export default Scale;
