import React, { useMemo, useState } from 'react';
import { assign, buildRing, cellColor, clientIds, makeCells, CELL_COLOR_VARS, FAILED_COLOR } from '../sim/simulation';

const CLIENT_COUNT = 100;
const CELL_COUNT = 4;

/**
 * Side-by-side contrast: a cell groups its WHOLE stack (LB → app → replica)
 * into one isolated failure domain, versus "redundancy at every layer" where
 * shared tiers are cross-wired and one bad replica degrades every user.
 */
const TopologyContrast: React.FC = () => {
  const [failed, setFailed] = useState(false);

  const W = 420;
  const COLS = [105, 210, 315];
  const BOX_W = 64;
  const TIERS = [
    { label: 'LB', y: 92 },
    { label: 'App', y: 138 },
    { label: 'Replica', y: 184 },
  ];
  const USERS = 12; // 3 groups of 4, group i pinned to cell i (left panel)

  const userDots = (mode: 'cells' | 'tiers') =>
    Array.from({ length: USERS }, (_, i) => {
      const group = Math.floor(i / 4);
      const x = 52 + i * 29;
      const groupColor = CELL_COLOR_VARS[group];
      const hardDown = failed && mode === 'cells' && group === 0;
      const degraded = failed && mode === 'tiers';
      return (
        <circle
          key={i}
          cx={x}
          cy={18}
          r={7}
          fill={hardDown ? FAILED_COLOR : groupColor}
          stroke={degraded ? FAILED_COLOR : 'none'}
          strokeWidth={degraded ? 3 : 0}
          strokeDasharray={degraded ? '3 2' : undefined}
        />
      );
    });

  const stackBoxes = (mode: 'cells' | 'tiers') =>
    COLS.map((cx, col) => (
      <g key={col}>
        {mode === 'cells' && (
          <>
            <rect x={cx - 44} y={78} width={88} height={150} rx={8} fill="none" stroke={cellColor(`cell-${'ABC'[col]}`)} strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={cx} y={244} textAnchor="middle" fontSize={11} fill="var(--ink-2)">Cell {'ABC'[col]}</text>
          </>
        )}
        {TIERS.map((tier, t) => {
          const isDead = failed && col === 0 && t === 2;
          const fill = isDead
            ? FAILED_COLOR
            : mode === 'cells'
              ? cellColor(`cell-${'ABC'[col]}`)
              : 'var(--baseline)';
          return (
            <g key={tier.label}>
              <rect x={cx - BOX_W / 2} y={tier.y} width={BOX_W} height={30} rx={5} fill={fill} />
              <text x={cx} y={tier.y + 19} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">
                {isDead ? '✗ ' : ''}{tier.label}{tier.label === 'Replica' ? ` ${'ABC'[col]}` : ''}
              </text>
            </g>
          );
        })}
      </g>
    ));

  const wires = (mode: 'cells' | 'tiers') => {
    const lines: React.ReactNode[] = [];
    // router bar (y=66 bottom) to each LB
    COLS.forEach((cx, i) =>
      lines.push(<line key={`r${i}`} x1={cx} y1={66} x2={cx} y2={92} stroke="var(--grid)" />)
    );
    if (mode === 'cells') {
      COLS.forEach((cx, i) => {
        lines.push(<line key={`a${i}`} x1={cx} y1={122} x2={cx} y2={138} stroke="var(--grid)" />);
        lines.push(<line key={`b${i}`} x1={cx} y1={168} x2={cx} y2={184} stroke="var(--grid)" />);
      });
    } else {
      // every-to-every between consecutive tiers: the "complex failure pattern"
      for (const [y1, y2] of [[122, 138], [168, 184]] as const) {
        COLS.forEach((x1, i) =>
          COLS.forEach((x2, j) =>
            lines.push(<line key={`m${y1}-${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--grid)" />)
          )
        );
      }
    }
    return lines;
  };

  const panel = (mode: 'cells' | 'tiers') => (
    <svg width="100%" viewBox={`0 0 ${W} 252`} style={{ maxWidth: W }} role="img"
      aria-label={mode === 'cells' ? 'Cells: isolated vertical stacks' : 'Shared tiers: cross-wired layers'}>
      {userDots(mode)}
      <rect x={40} y={44} width={340} height={22} rx={4} fill="none" stroke="var(--baseline)" />
      <text x={W / 2} y={59} textAnchor="middle" fontSize={11} fill="var(--ink-2)">Routing layer</text>
      {wires(mode)}
      {stackBoxes(mode)}
    </svg>
  );

  return (
    <div className="panel">
      <div className="controls">
        <strong>Cells ≠ redundancy at every layer.</strong>
        <span style={{ flex: 1 }} />
        {!failed ? (
          <button className="danger" onClick={() => setFailed(true)}>💥 Fail Replica A in both</button>
        ) : (
          <button onClick={() => setFailed(false)}>Recover</button>
        )}
      </div>
      <div className="viz-flex" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}>
          {panel('cells')}
          <div className="stat">
            <div className={`value ${failed ? '' : ''}`} style={{ fontSize: '1.1rem' }}>
              {failed ? '4 of 12 users down — 8 untouched' : 'Simple failure pattern'}
            </div>
            <div className="label">each cell contains its whole stack; a failure stays inside the dashed box</div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          {panel('tiers')}
          <div className="stat">
            <div className="value" style={{ fontSize: '1.1rem' }}>
              {failed ? '12 of 12 users degraded (1 in 3 requests fail)' : 'Complex failure pattern'}
            </div>
            <div className="label">shared, cross-wired tiers look redundant — but one bad replica touches every user's traffic</div>
          </div>
        </div>
      </div>
    </div>
  );
};

const WhyCells: React.FC = () => {
  const [mode, setMode] = useState<'monolith' | 'cells'>('monolith');
  const [failed, setFailed] = useState(false);

  const cells = useMemo(() => makeCells(CELL_COUNT), []);
  const clients = useMemo(() => clientIds(CLIENT_COUNT, 'user'), []);
  const assignment = useMemo(() => assign(clients, buildRing(cells)), [cells, clients]);

  // In cell mode, fail the cell that owns the most clients — the worst case.
  const failedCell = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, cellId] of assignment) counts.set(cellId, (counts.get(cellId) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [assignment]);

  const affected =
    !failed ? 0 : mode === 'monolith' ? CLIENT_COUNT : [...assignment.values()].filter((c) => c === failedCell).length;

  return (
    <section className="lesson" id="why-cells">
      <div className="kicker">01 · The problem</div>
      <h2>Why cells? Blast radius.</h2>
      <p>
        A traditional architecture is one big shared system: one fleet, one database, one failure
        domain. When something breaks — a bad deploy, a poison-pill request, an overloaded
        dependency — it breaks for <em>everyone</em>. A cell-based architecture splits the workload
        into independent, identical replicas called <strong>cells</strong>, and pins every client to
        exactly one of them. The same outage now touches only the clients in the affected cell.
      </p>
      <div className="panel">
        <div className="controls">
          <button className={mode === 'monolith' ? 'selected' : ''} onClick={() => { setMode('monolith'); setFailed(false); }}>
            One big system
          </button>
          <button className={mode === 'cells' ? 'selected' : ''} onClick={() => { setMode('cells'); setFailed(false); }}>
            {CELL_COUNT} cells
          </button>
          <span style={{ flex: 1 }} />
          {!failed ? (
            <button className="danger" onClick={() => setFailed(true)}>💥 Trigger a failure</button>
          ) : (
            <button onClick={() => setFailed(false)}>Recover</button>
          )}
        </div>
        <div className="dot-grid" role="img" aria-label={`${CLIENT_COUNT} clients, ${affected} affected by failure`}>
          {clients.map((id) => {
            const cellId = assignment.get(id)!;
            const isAffected = failed && (mode === 'monolith' || cellId === failedCell);
            const color =
              mode === 'monolith' ? 'var(--baseline)' : cellColor(cellId);
            return (
              <div
                key={id}
                className="dot"
                title={mode === 'cells' ? `${id} → ${cellId}` : id}
                style={{
                  background: isAffected ? FAILED_COLOR : color,
                  opacity: failed && !isAffected ? 0.9 : 1,
                }}
              />
            );
          })}
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className={`value ${failed ? (affected === CLIENT_COUNT ? 'bad' : '') : ''}`}>{affected}%</div>
            <div className="label">of clients affected by the failure</div>
          </div>
          <div className="stat">
            <div className={`value ${failed && affected < CLIENT_COUNT ? 'good' : ''}`}>{100 - affected}%</div>
            <div className="label">of clients who never notice</div>
          </div>
        </div>
        {mode === 'cells' && (
          <div className="legend">
            {cells.map((c) => (
              <span key={c.cellId}>
                <span className="swatch" style={{ background: cellColor(c.cellId) }} />
                {c.cellId}
              </span>
            ))}
          </div>
        )}
      </div>
      <p style={{ marginTop: '2rem' }}>
        A common objection: "we already have redundancy at every layer." That's not the same
        thing. Cross-wired shared tiers create a <em>complex</em> failure pattern — a single bad
        replica sits in every user's request path, so everyone degrades a little. Cells group the
        whole stack into one isolated failure domain, so a failure is total for a few and
        invisible to everyone else:
      </p>
      <TopologyContrast />
      <div className="callout">
        <strong>The math is honest:</strong> with N equal cells, one cell failing affects roughly
        1/N of your clients — 25% here, not 100%. And unlike shared tiers, the other cells aren't
        just "probably fine" — they can't even be reached by the failure. The catch: you now need
        a way to decide, consistently, which cell each client belongs to. That's the next section.
      </div>
    </section>
  );
};

export default WhyCells;
