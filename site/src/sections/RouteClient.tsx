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
import TryLive from '../TryLive';
import Sidequest from '../ui/Sidequest';
import Icon from '../ui/icons';

const CELL_COUNT = 4;
const SIZE = 300;
const CX = SIZE / 2;
const CY = SIZE / 2;

/* ------------------------------------------------------------------ */
/* Sidequest: pinning one client on top of the hash                    */
/* ------------------------------------------------------------------ */

const VIP = 'vip-42';
const REGULARS = ['alice', 'bob', 'carol', 'dave', 'erin'];

const PinningDemo: React.FC = () => {
  const cells = useMemo(() => makeCells(CELL_COUNT), []);
  const ring = useMemo(() => buildRing(cells), [cells]);

  // Hash owners on the healthy ring — fixed, since the ring is fixed.
  const hashOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const id of [...REGULARS, VIP]) {
      const cell = ring.getCell(id);
      if (cell) m.set(id, cell.cellId);
    }
    return m;
  }, [ring]);

  const vipHashOwner = hashOwner.get(VIP)!;

  // Default pin: the first cell that is NOT vip-42's hash owner, so the
  // override visibly moves it somewhere the hash would not.
  const [pin, setPin] = useState(() => cells.find((c) => c.cellId !== vipHashOwner)!.cellId);
  const [failed, setFailed] = useState(false);
  const [policy, setPolicy] = useState<'hash' | 'closed'>('hash');

  // Ring without the failed cell, for hash-fallback assignment.
  const survivorRing = useMemo(
    () => buildRing(cells.filter((c) => c.cellId !== pin)),
    [cells, pin]
  );

  const changePin = (cellId: string) => {
    setPin(cellId);
    setFailed(false); // re-pinning implies the operator fixed things
  };

  // Where does each client actually sit right now?
  const placement = new Map<string, string>();
  for (const id of REGULARS) {
    const owner = hashOwner.get(id)!;
    placement.set(id, failed && owner === pin ? survivorRing.getCell(id)!.cellId : owner);
  }
  const vipFallback = failed ? survivorRing.getCell(VIP)!.cellId : pin;
  const vipErroring = failed && policy === 'closed';
  const vipRerouted = failed && policy === 'hash';
  placement.set(VIP, vipErroring ? pin : vipRerouted ? vipFallback : pin);

  let status: React.ReactNode;
  let statusClass = 'pin-status';
  if (!failed) {
    status = (
      <>
        <strong>{VIP}</strong> is pinned to <strong>{pin}</strong> by an override row; its hash
        owner would be {vipHashOwner}. Everyone else routes by hash alone.
      </>
    );
  } else if (policy === 'hash') {
    statusClass += ' warn';
    status = (
      <>
        {pin} is down. Fallback = hash: <strong>{VIP}</strong> re-routes to{' '}
        <strong>{vipFallback}</strong>
        {vipFallback === vipHashOwner ? ' — its hash owner' : ''}. Only safe if {VIP}'s state is
        replicated or stateless: if its data lives in {pin}, you just routed it to a cell that
        has never seen it (data gravity).
      </>
    );
  } else {
    statusClass += ' bad';
    status = (
      <>
        {pin} is down. Fail closed: <strong>{VIP}</strong> gets an error while everyone else
        keeps working — correctness over availability, and the blast radius is exactly the
        pinned clients.
      </>
    );
  }

  return (
    <div data-testid="pinning-demo">
      <div className="controls">
        <fieldset className="pin-fieldset">
          <legend>Pin {VIP} to:</legend>
          {cells.map((c) => (
            <button
              key={c.cellId}
              className={pin === c.cellId ? 'selected' : ''}
              aria-pressed={pin === c.cellId}
              onClick={() => changePin(c.cellId)}
            >
              <span className="swatch" style={{ background: cellColor(c.cellId) }} />
              {c.cellId}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="controls">
        <fieldset className="pin-fieldset">
          <legend>If the pinned cell dies:</legend>
          <button
            className={policy === 'hash' ? 'selected' : ''}
            aria-pressed={policy === 'hash'}
            onClick={() => setPolicy('hash')}
          >
            Fall back to the hash
          </button>
          <button
            className={policy === 'closed' ? 'selected' : ''}
            aria-pressed={policy === 'closed'}
            onClick={() => setPolicy('closed')}
          >
            Fail closed
          </button>
        </fieldset>
        <span style={{ flex: 1 }} />
        {!failed ? (
          <button className="danger" onClick={() => setFailed(true)}>
            <Icon name="skull" /> Fail {pin}
          </button>
        ) : (
          <button onClick={() => setFailed(false)}>
            <Icon name="refresh" /> Revive {pin}
          </button>
        )}
      </div>
      <div className="pin-cells">
        {cells.map((c) => {
          const isDown = failed && c.cellId === pin;
          const residents = [...REGULARS, VIP].filter((id) => placement.get(id) === c.cellId);
          return (
            <div key={c.cellId} className={`pin-cell${isDown ? ' failed' : ''}`}>
              <div className="title">
                <span
                  className="swatch"
                  style={{ background: isDown ? 'var(--critical)' : cellColor(c.cellId) }}
                />
                {c.cellId}
                {isDown && <span className="down-tag">down</span>}
              </div>
              <div className="pin-clients">
                {residents.map((id) =>
                  id === VIP ? (
                    <span
                      key={id}
                      data-testid="vip-chip"
                      className={`pin-chip vip${vipRerouted ? ' rerouted' : ''}${
                        vipErroring ? ' erroring' : ''
                      }`}
                    >
                      <Icon name={vipErroring ? 'x-circle' : 'map-pin'} size={12} />
                      {id}
                    </span>
                  ) : (
                    <span key={id} className="pin-chip">
                      {id}
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className={statusClass} data-testid="pin-status" role="status">
        {status}
      </p>
    </div>
  );
};

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
      <Sidequest
        id="sidequest-pinning"
        title="Pinning a client — and the fallback question"
        blurb={
          <>
            Sometimes you need client X on cell Y regardless of the hash — VIP tenants,
            migrations, draining. That's a directory override on top of the hash, and it forces
            one hard question: what happens when the pinned cell is down?
          </>
        }
      >
        <p>
          The mechanism is an <strong>override table</strong> — a small key→cell map (a DynamoDB
          table, say) checked <em>before</em> the hash. Hit: route to the listed cell. Miss: the
          hash decides, exactly as above, for everyone else. Overrides are what make migration
          and draining possible — write the row, move the data, delete the row — but they
          reintroduce a stateful lookup on the routing path, the very thing pure hashing avoided.
          So they stay small, cached, and TTL'd: an exception list, not a second router.
        </p>
        <p>
          And every row in that table needs a failure story. Pin {'"'}vip-42{'"'} below, fail its
          cell, and try both answers:
        </p>
        <PinningDemo />
        <p>
          The deployed demo's registry already stores per-cell <code>active</code> flags — an
          override table is the same idea one level down: routing state must always carry a
          health-aware fallback story, or a single row in a table becomes a single point of
          failure for that client.
        </p>
      </Sidequest>
      <TryLive path="/router.html">Route your real browser through the deployed router</TryLive>
    </section>
  );
};

export default RouteClient;
