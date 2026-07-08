import React, { useMemo, useState } from 'react';
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

const CELL_COUNT = 4;
const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;

interface RouteEntry {
  clientId: string;
  hash: number;
  cellId: string;
}

const PRESETS = ['user123', 'customer456', 'admin789'];

const RouteClient: React.FC = () => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<RouteEntry[]>([]);

  const cells = useMemo(() => makeCells(CELL_COUNT), []);
  const ring = useMemo(() => buildRing(cells), [cells]);
  const arcs = useMemo(() => ownershipArcs(ring), [ring]);

  const current = history[0];

  const route = (clientId: string) => {
    const id = clientId.trim();
    if (!id) return;
    const cell = ring.getCell(id);
    if (!cell) return;
    setHistory((h) => [{ clientId: id, hash: hashKey(id), cellId: cell.cellId }, ...h].slice(0, 8));
  };

  const marker = current ? pointOnCircle(CX, CY, 113, current.hash / MAX_HASH) : null;

  return (
    <section className="lesson" id="route-a-client">
      <div className="kicker">03 · Determinism</div>
      <h2>Route a client — same answer, every time</h2>
      <p>
        Type any client ID. It is MD5-hashed onto the ring (the dot), walks clockwise, and lands in
        the owning cell's arc. There is no lookup table and no coordination — any router anywhere
        in the world computes the same answer from the ID alone. That's what keeps a user's
        sessions, caches, and data in one predictable place.
      </p>
      <div className="panel">
        <div className="controls">
          <input
            type="text"
            placeholder="Enter a client ID (e.g. alice@example.com)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && route(input)}
            aria-label="Client ID to route"
          />
          <button className="primary" onClick={() => route(input)}>
            Route it
          </button>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => route(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="viz-flex">
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Client position on the hash ring">
            {arcs.map((arc, i) => (
              <path
                key={i}
                d={arcPath(CX, CY, 130, 96, arc.start, arc.end)}
                fill={cellColor(arc.cellId)}
                opacity={current && arc.cellId !== current.cellId ? 0.15 : 1}
              />
            ))}
            {marker && current && (
              <>
                <circle cx={marker.x} cy={marker.y} r={7} fill="var(--ink)" stroke="var(--surface-1)" strokeWidth={2} />
                <text x={CX} y={CY - 6} textAnchor="middle" fill="var(--ink)" fontSize="15" fontWeight={700}>
                  {current.cellId}
                </text>
                <text x={CX} y={CY + 14} textAnchor="middle" fill="var(--muted)" fontSize="11">
                  owns {current.clientId.length > 18 ? current.clientId.slice(0, 15) + '…' : current.clientId}
                </text>
              </>
            )}
            {!current && (
              <text x={CX} y={CY + 4} textAnchor="middle" fill="var(--muted)" fontSize="12">
                route a client to see it land
              </text>
            )}
          </svg>
          <div className="side">
            {current && (
              <div className="stat-row" style={{ marginTop: 0 }}>
                <div className="stat">
                  <div className="value" style={{ fontSize: '1.1rem' }}>
                    <span className="hash-chip">md5("{current.clientId}") → {current.hash.toLocaleString()}</span>
                  </div>
                  <div className="label">position on the 2³² ring</div>
                </div>
              </div>
            )}
            <div className="route-history">
              {history.map((entry, i) => (
                <div className="entry" key={`${entry.clientId}-${i}`}>
                  <span className="swatch" style={{ background: cellColor(entry.cellId) }} />
                  <span style={{ flex: 1 }}>{entry.clientId}</span>
                  <span className="hash-chip">{entry.cellId}</span>
                </div>
              ))}
            </div>
            {history.length > 1 && (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 0 }}>
                Route the same ID again — it always lands in the same cell.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="callout">
        <strong>Same code as production:</strong> this page imports the repository's actual{' '}
        <code>ConsistentHash</code> class from <code>backend/lib/consistent-hash.ts</code> — the one
        the routing Lambda runs. What you see here is exactly what the deployed router decides.
        In fact, this page IS a router: since the computation is identical wherever it runs, the
        "routing layer" could live inside every cell — or in the client — rather than being a
        separate service (more in trade-offs below).
      </div>
    </section>
  );
};

export default RouteClient;
