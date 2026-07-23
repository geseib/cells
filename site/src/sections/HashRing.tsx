import React, { useMemo, useState } from 'react';
import { arcPath, buildRing, cellColor, keyspaceShare, makeCells, ownershipArcs } from '../sim/simulation';
import TryLive from '../TryLive';
import KeyHint, { useHotkeys } from '../ui/KeyHint';
import Sidequest from '../ui/Sidequest';

const CELL_COUNT = 4;
const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** The virtual-node ring demo — used by the section below and the slide deck. */
export const HashRingDemo: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [virtualNodes, setVirtualNodes] = useState(8);

  // Presenter keys (slide deck only): vnode presets
  useHotkeys(hotkeys, {
    '1': () => setVirtualNodes(1),
    '2': () => setVirtualNodes(8),
    '3': () => setVirtualNodes(150),
  });
  const cells = useMemo(() => makeCells(CELL_COUNT), []);
  const ring = useMemo(() => buildRing(cells, virtualNodes), [cells, virtualNodes]);
  const arcs = useMemo(() => ownershipArcs(ring), [ring]);
  const shares = useMemo(() => keyspaceShare(ring), [ring]);

  const ideal = 100 / CELL_COUNT;

  return (
    <div className="panel">
        <div className="controls">
          <label htmlFor="vnode-slider">
            Virtual nodes per cell: <strong>{virtualNodes}</strong>
            {hotkeys && <> <KeyHint k="1" />1 <KeyHint k="2" />8 <KeyHint k="3" />150</>}
          </label>
          <input
            id="vnode-slider"
            type="range"
            min={1}
            max={150}
            value={virtualNodes}
            onChange={(e) => setVirtualNodes(Number(e.target.value))}
            style={{ flex: '1 1 200px' }}
          />
        </div>
        <div className="viz-flex">
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Hash ring ownership by cell">
            {arcs.map((arc, i) => (
              <path
                key={i}
                d={arcPath(CX, CY, 130, 96, arc.start, arc.end)}
                fill={cellColor(arc.cellId)}
                stroke="var(--surface-1)"
                strokeWidth={virtualNodes <= 40 ? 1.5 : 0}
              />
            ))}
            <text x={CX} y={CY - 6} textAnchor="middle" fill="var(--ink-2)" fontSize="13">
              2³² keyspace
            </text>
            <text x={CX} y={CY + 14} textAnchor="middle" fill="var(--muted)" fontSize="11">
              {arcs.length} virtual nodes
            </text>
            <text x={CX} y={16} textAnchor="middle" fill="var(--muted)" fontSize="10">0 / 2³²</text>
          </svg>
          <div className="side">
            <table className="data">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>Keyspace share</th>
                  <th>vs. ideal {ideal}%</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => {
                  const share = (shares.get(c.cellId) || 0) * 100;
                  const delta = share - ideal;
                  return (
                    <tr key={c.cellId}>
                      <td>
                        <span className="swatch" style={{ background: cellColor(c.cellId) }} /> {c.cellId}
                      </td>
                      <td>{share.toFixed(1)}%</td>
                      <td style={{ color: Math.abs(delta) > 5 ? 'var(--critical)' : 'var(--good)' }}>
                        {delta >= 0 ? '+' : ''}
                        {delta.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
    </div>
  );
};

const HashRing: React.FC = () => {
  return (
    <section className="lesson" id="hash-ring">
      <div className="kicker">02 · The mechanism</div>
      <h2>The hash ring</h2>
      <p>
        Imagine the entire range of a hash function — 0 to 2³² — bent into a circle. Each cell
        places markers called <strong>virtual nodes</strong> around that circle (each marker is just
        the MD5 hash of <code>"cellId:i"</code>). A client is routed by hashing its ID onto the
        circle and walking clockwise to the next marker: that marker's cell owns the client. Each
        colored arc below is the slice of keyspace one cell owns.
      </p>
      <HashRingDemo />
      <div className="callout">
        <strong>Try it:</strong> drag the slider down to 1 virtual node per cell — the shares get
        wildly uneven, because a few random points rarely split a circle fairly. At 150 per cell
        (what the real backend uses), every cell converges on its fair share. Virtual nodes are the
        trick that makes consistent hashing <em>balanced</em>.
      </div>
      <Sidequest
        id="sidequest-which-hash"
        title="Which hash? Every library has opinions"
        blurb={
          <>
            Many algorithms and libraries implement "consistent hashing" — and they do not agree
            with each other. Each one is a real trade-off, not a drop-in swap.
          </>
        }
      >
        <p>
          Two "consistent hash" libraries will happily give different answers for the same key —
          different hash function, different seed, different vnode recipe — and a fleet that mixes
          them quietly splits its routing. That is why this repo pins one exact recipe and guards
          it with a golden value — <span className="hash-chip">md5("user123") → 1,792,101,289</span>{' '}
          — asserted by the backend's jest test, computed by the routing Lambda, by this page, and
          re-checked by the post-deploy smoke test. If you adopt a library per language instead,
          cross-verify them with golden values before anything routes for real.
        </p>
        <p>
          Full algorithm-by-algorithm comparison in{' '}
          <a href="#hash-choices">07 · Choosing your hash</a>.
        </p>
      </Sidequest>
      <TryLive>See the live ring built from real registered cells in the admin dashboard</TryLive>
    </section>
  );
};

export default HashRing;
