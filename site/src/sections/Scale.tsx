import React, { useMemo, useState } from 'react';
import { assign, buildRing, cellColor, clientIds, countMoved, hashKey, makeCells, CELL_NAMES } from '../sim/simulation';
import TryLive from '../TryLive';
import KeyHint, { useHotkeys } from '../ui/KeyHint';

const CLIENT_COUNT = 400;
const MIN_CELLS = 2;
const MAX_CELLS = 8;

/** The add-a-cell movement demo — used by the section below and the slide deck. */
export const ScaleDemo: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [cellCount, setCellCount] = useState(3);

  // Presenter keys (slide deck only): A adds a cell, X removes one
  useHotkeys(hotkeys, {
    a: () => setCellCount((n) => Math.min(MAX_CELLS - 1, n + 1)),
    x: () => setCellCount((n) => Math.max(MIN_CELLS, n - 1)),
  });
  const clients = useMemo(() => clientIds(CLIENT_COUNT), []);

  // % of clients that move when growing from (n) to (n+1) cells, both strategies
  const growth = useMemo(() => {
    const cellsBefore = makeCells(cellCount);
    const cellsAfter = makeCells(cellCount + 1);

    const consistentBefore = assign(clients, buildRing(cellsBefore));
    const consistentAfter = assign(clients, buildRing(cellsAfter));
    const consistentMoved = countMoved(consistentBefore, consistentAfter);

    let moduloMoved = 0;
    for (const id of clients) {
      if (hashKey(id) % cellCount !== hashKey(id) % (cellCount + 1)) moduloMoved++;
    }

    return {
      consistent: (consistentMoved / CLIENT_COUNT) * 100,
      modulo: (moduloMoved / CLIENT_COUNT) * 100,
      ideal: (1 / (cellCount + 1)) * 100,
      after: consistentAfter,
    };
  }, [cellCount, clients]);

  const cellsAfter = useMemo(() => makeCells(cellCount + 1), [cellCount]);
  const regions = useMemo(() => {
    const map = new Map<string, typeof cellsAfter>();
    for (const c of cellsAfter) {
      if (!map.has(c.region)) map.set(c.region, []);
      map.get(c.region)!.push(c);
    }
    return [...map.entries()];
  }, [cellsAfter]);

  return (
    <div className="panel">
        <div className="controls">
          <label>
            Growing from <strong>{cellCount}</strong> to <strong>{cellCount + 1}</strong> cells
            {hotkeys && <> <KeyHint k="A" />+<KeyHint k="X" />−</>}
          </label>
          <input
            type="range"
            min={MIN_CELLS}
            max={MAX_CELLS - 1}
            value={cellCount}
            onChange={(e) => setCellCount(Number(e.target.value))}
            style={{ flex: '1 1 200px' }}
            aria-label="Number of cells before adding one"
          />
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className="value good">{growth.consistent.toFixed(0)}%</div>
            <div className="label">clients moved — consistent hashing (ideal ≈ {growth.ideal.toFixed(0)}%)</div>
          </div>
          <div className="stat">
            <div className="value bad">{growth.modulo.toFixed(0)}%</div>
            <div className="label">clients moved — naive hash&nbsp;mod&nbsp;N</div>
          </div>
        </div>
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

const Scale: React.FC = () => {
  return (
    <section className="lesson" id="scale">
      <div className="kicker">05 · Elasticity</div>
      <h2>Scale out by adding cells</h2>
      <p>
        Capacity management becomes cookie-cutter: need more headroom, stamp out another cell.
        When a new cell joins the ring it claims a proportional slice of the keyspace, taking a
        thin sliver from every existing cell. Compare how much traffic moves under consistent
        hashing versus the naive <code>hash mod N</code> approach:
      </p>
      <ScaleDemo />
      <div className="callout">
        <strong>Cells also cap other risks:</strong> deployments roll cell-by-cell (a bad release
        hits one cell, not the fleet), load tests validate one cell's known capacity, and a
        "poison" customer who triggers a crash loop only takes down the cell they hash to.
      </div>
      <TryLive>Toggle whole regions on and off in the live admin dashboard</TryLive>
    </section>
  );
};

export default Scale;
