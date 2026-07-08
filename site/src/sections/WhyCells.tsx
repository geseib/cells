import React, { useMemo, useState } from 'react';
import { assign, buildRing, cellColor, clientIds, makeCells, FAILED_COLOR } from '../sim/simulation';

const CLIENT_COUNT = 100;
const CELL_COUNT = 4;

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
      <div className="callout">
        <strong>The math is honest:</strong> with N equal cells, one cell failing affects roughly
        1/N of your clients — 25% here, not 100%. More cells, smaller blast radius. The catch: you
        now need a way to decide, consistently, which cell each client belongs to. That's the next
        section.
      </div>
    </section>
  );
};

export default WhyCells;
