import React, { useMemo, useState } from 'react';
import { assign, buildRing, cellColor, clientIds, makeCells, CELL_COLOR_VARS, FAILED_COLOR } from '../sim/simulation';

const CLIENT_COUNT = 100;
const CELL_COUNT = 4;

/**
 * Side-by-side contrast: a cell groups its WHOLE stack (LB → app → replica)
 * into one isolated failure domain, versus "redundancy at every layer" where
 * shared tiers are cross-wired and one bad replica degrades every user.
 *
 * The story is told with request FLOWS: on the cells side each user group's
 * flow runs straight down its own stack, so a failure breaks one flow at one
 * obvious place. On the tiers side each group's flow fans out across the
 * shared tiers, so a dead replica puts some red in EVERY group's traffic.
 */
const TopologyContrast: React.FC = () => {
  const [failed, setFailed] = useState(false);

  const W = 420;
  const H = 258;
  const COLS = [105, 210, 315];
  const BOX_W = 64;
  const BOX_H = 26;
  const TIERS = [
    { label: 'LB', y: 94 },
    { label: 'App', y: 146 },
    { label: 'Replica', y: 198 },
  ];
  const GROUPS = 3;
  const USERS = 12; // 3 groups of 4, group i pinned to cell i (left panel)

  /** Horizontal center of user group g's four dots. */
  const groupX = (g: number) => 52 + 29 * (g * 4 + 1.5);

  const userDots = (mode: 'cells' | 'tiers') =>
    Array.from({ length: USERS }, (_, i) => {
      const group = Math.floor(i / 4);
      const x = 52 + i * 29;
      const groupColor = CELL_COLOR_VARS[group];
      const hardDown = failed && mode === 'cells' && group === 0;
      const degraded = failed && mode === 'tiers';
      return (
        <g key={i}>
          <circle cx={x} cy={18} r={7} fill={hardDown ? FAILED_COLOR : groupColor} opacity={hardDown ? 0.85 : 1} />
          {degraded && (
            <circle cx={x} cy={18} r={10.5} fill="none" stroke={FAILED_COLOR} strokeWidth={1.5} strokeDasharray="3 3" />
          )}
        </g>
      );
    });

  /**
   * Request flows, drawn under the boxes (which are opaque, so lines only
   * show in the gaps between layers — reading as traffic passing through).
   * Cells: one straight flow per group down its own column. Tiers: three
   * representative routes per group, one per replica, crossing columns so
   * the shared fan-out is visible as mixed colors.
   */
  const flows = (mode: 'cells' | 'tiers') => {
    const paths: React.ReactNode[] = [];
    const repY = TIERS[2].y;
    const appBottom = TIERS[1].y + BOX_H;
    for (let g = 0; g < GROUPS; g++) {
      const ucx = groupX(g);
      const cellDead = failed && mode === 'cells' && g === 0;
      const color = cellDead ? FAILED_COLOR : CELL_COLOR_VARS[g];
      // stub from the user group into the routing bar (bar is opaque)
      paths.push(
        <path key={`in-${g}`} d={`M ${ucx} 27 V 56`} stroke={color} strokeWidth={2.5} fill="none"
          strokeDasharray={cellDead ? '5 4' : undefined} className={cellDead ? 'flow-broken' : undefined} />
      );
      if (mode === 'cells') {
        paths.push(
          <path key={`f-${g}`} d={`M ${COLS[g]} 56 V ${repY + BOX_H - 4}`} stroke={color} strokeWidth={2.5} fill="none"
            strokeDasharray={cellDead ? '5 4' : undefined} className={cellDead ? 'flow-broken' : undefined} />
        );
      } else {
        const off = (g - 1) * 7; // keep parallel segments from overlapping
        for (let r = 0; r < GROUPS; r++) {
          const lbx = COLS[(g + r) % 3] + off;
          const ax = COLS[(g + 2 * r + 1) % 3] + off;
          const rx = COLS[r] + off;
          const broken = failed && r === 0; // routes that terminate at Replica A
          paths.push(
            <path key={`t-${g}-${r}`} fill="none" stroke={CELL_COLOR_VARS[g]} strokeWidth={1.8} opacity={0.9}
              d={`M ${lbx} 56 V ${TIERS[0].y + BOX_H} C ${lbx} ${TIERS[1].y - 6}, ${ax} ${TIERS[0].y + BOX_H + 6}, ${ax} ${TIERS[1].y} V ${appBottom}`} />
          );
          paths.push(
            <path key={`b-${g}-${r}`} fill="none" strokeWidth={broken ? 2.2 : 1.8} opacity={0.9}
              stroke={broken ? FAILED_COLOR : CELL_COLOR_VARS[g]}
              strokeDasharray={broken ? '5 4' : undefined}
              className={broken ? 'flow-broken' : undefined}
              d={`M ${ax} ${appBottom} C ${ax} ${repY - 6}, ${rx} ${appBottom + 6}, ${rx} ${repY} V ${repY + BOX_H - 4}`} />
          );
        }
      }
    }
    return paths;
  };

  const stackBoxes = (mode: 'cells' | 'tiers') =>
    COLS.map((cx, col) => {
      const cellDown = failed && mode === 'cells' && col === 0;
      return (
        <g key={col}>
          {mode === 'cells' && (
            <>
              <rect x={cx - 44} y={80} width={88} height={152} rx={8} fill="none"
                stroke={cellDown ? FAILED_COLOR : cellColor(`cell-${'ABC'[col]}`)} strokeDasharray="5 4" strokeWidth={1.5} />
              <text x={cx} y={248} textAnchor="middle" fontSize={11}
                fill={cellDown ? FAILED_COLOR : 'var(--ink-2)'} fontWeight={cellDown ? 700 : 400}>
                Cell {'ABC'[col]}{cellDown ? ' — down' : ''}
              </text>
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
                <rect x={cx - BOX_W / 2} y={tier.y} width={BOX_W} height={BOX_H} rx={5} fill={fill}
                  opacity={cellDown && !isDead ? 0.5 : 1} />
                <text x={cx} y={tier.y + 17} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff"
                  opacity={cellDown && !isDead ? 0.6 : 1}>
                  {isDead ? '✗ ' : ''}{tier.label}{tier.label === 'Replica' ? ` ${'ABC'[col]}` : ''}
                </text>
              </g>
            );
          })}
        </g>
      );
    });

  const panel = (mode: 'cells' | 'tiers') => (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img"
      aria-label={mode === 'cells'
        ? 'Cells: each user group flows straight down its own isolated stack'
        : 'Shared tiers: every user group fans out across cross-wired layers'}>
      {userDots(mode)}
      {flows(mode)}
      <rect x={40} y={44} width={340} height={22} rx={4} fill="var(--surface-1)" stroke="var(--baseline)" />
      <text x={W / 2} y={59} textAnchor="middle" fontSize={11} fill="var(--ink-2)">Routing layer</text>
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
            <div className="value" style={{ fontSize: '1.1rem' }}>
              {failed ? '4 of 12 users down — 8 untouched' : 'Simple failure pattern'}
            </div>
            <div className="label">
              {failed
                ? "cell A's whole flow breaks at one obvious place; the other flows never touch it"
                : 'each group’s flow runs straight down its own cell; a failure stays inside the dashed box'}
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 300px' }}>
          {panel('tiers')}
          <div className="stat">
            <div className="value" style={{ fontSize: '1.1rem' }}>
              {failed ? '12 of 12 users degraded (1 in 3 requests fail)' : 'Complex failure pattern'}
            </div>
            <div className="label">
              {failed
                ? 'every group has a flow ending at the dead replica — the failure has no clean boundary'
                : 'each group’s flow fans out across shared tiers, so every replica sits in every user’s path'}
            </div>
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
        {mode === 'monolith' ? (
          <div className="dot-grid" role="img" aria-label={`${CLIENT_COUNT} clients in one shared system, ${affected} affected by failure`}>
            {clients.map((id) => (
              <div
                key={id}
                className="dot"
                title={id}
                style={{ background: failed ? FAILED_COLOR : 'var(--baseline)' }}
              />
            ))}
          </div>
        ) : (
          <div className="cell-groups" role="img" aria-label={`${CLIENT_COUNT} clients split across ${CELL_COUNT} cells, ${affected} affected by failure`}>
            {cells.map((c) => {
              const members = clients.filter((id) => assignment.get(id) === c.cellId);
              const isDown = failed && c.cellId === failedCell;
              const color = isDown ? FAILED_COLOR : cellColor(c.cellId);
              return (
                <div key={c.cellId} className={`cell-group${isDown ? ' failed' : ''}`} style={{ borderColor: color }}>
                  <div className="title" style={{ color }}>
                    {c.cellId} · {members.length} clients{isDown ? ' — down' : ''}
                  </div>
                  <div className="dots">
                    {members.map((id) => (
                      <div
                        key={id}
                        className="dot"
                        title={`${id} → ${c.cellId}`}
                        style={{ background: color, opacity: isDown ? 0.85 : 1 }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
