import React, { useMemo, useState } from 'react';
import { assign, buildRing, cellColor, clientIds, countMoved, hashKey, makeCells } from '../sim/simulation';
import TryLive from '../TryLive';
import KeyHint, { useHotkeys } from '../ui/KeyHint';

const CELL_COUNT = 4;
const CLIENT_COUNT = 200;

/** The kill-a-cell demo — used by the section below and the slide deck. */
export const KillCellDemo: React.FC<{ hotkeys?: boolean }> = ({ hotkeys = false }) => {
  const [failedCells, setFailedCells] = useState<Set<string>>(new Set());

  const cells = useMemo(() => makeCells(CELL_COUNT), []);
  const clients = useMemo(() => clientIds(CLIENT_COUNT), []);
  const baseline = useMemo(() => assign(clients, buildRing(cells)), [cells, clients]);

  const liveCells = cells.filter((c) => !failedCells.has(c.cellId));
  const current = useMemo(
    () => assign(clients, buildRing(liveCells)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clients, failedCells]
  );

  const moved = countMoved(baseline, current);
  const anyFailed = failedCells.size > 0;

  // The honest contrast: with naive hash(id) mod N routing, shrinking N
  // remaps almost EVERY client, not just the failed cell's share.
  const modMoved = useMemo(() => {
    if (!anyFailed) return 0;
    let count = 0;
    for (const id of clients) {
      const before = cells[hashKey(id) % cells.length].cellId;
      const after = liveCells[hashKey(id) % liveCells.length].cellId;
      if (before !== after) count++;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, cells, anyFailed, failedCells]);

  const toggle = (cellId: string) => {
    setFailedCells((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else if (next.size < CELL_COUNT - 1) next.add(cellId); // keep at least one cell alive
      return next;
    });
  };

  // Presenter keys (slide deck only): 1-4 toggle each cell, R revives all
  const cellIds = cells.map((c) => c.cellId);
  useHotkeys(hotkeys, {
    '1': () => toggle(cellIds[0]),
    '2': () => toggle(cellIds[1]),
    '3': () => toggle(cellIds[2]),
    '4': () => toggle(cellIds[3]),
    r: () => setFailedCells(new Set()),
  });

  const byCell = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const c of cells) map.set(c.cellId, []);
    for (const [clientId, cellId] of current) map.get(cellId)?.push(clientId);
    return map;
  }, [cells, current]);

  return (
    <div className="panel">
        <div className="cell-grid">
          {cells.map((cell) => {
            const isFailed = failedCells.has(cell.cellId);
            const residents = byCell.get(cell.cellId) || [];
            return (
              <div
                key={cell.cellId}
                className={`cell-card ${isFailed ? 'failed' : ''}`}
                onClick={() => toggle(cell.cellId)}
                role="button"
                aria-pressed={isFailed}
                title={isFailed ? 'Click to recover' : 'Click to fail this cell'}
              >
                <h4>
                  <span className="swatch" style={{ background: isFailed ? 'var(--critical)' : cellColor(cell.cellId) }} />{' '}
                  {cell.cellId} {isFailed ? '· FAILED' : ''}
                  {hotkeys && <KeyHint k={String(cells.indexOf(cell) + 1)} />}
                </h4>
                <div className="meta">
                  {cell.region} · {cell.availabilityZone} · {isFailed ? 0 : residents.length} clients
                </div>
                <div className="mini-dots">
                  {residents.slice(0, 60).map((clientId) => {
                    // Dots keep their ORIGINAL cell's color, so refugees from a
                    // failed cell are visible at a glance inside their new home.
                    const originCell = baseline.get(clientId)!;
                    const movedHere = originCell !== cell.cellId;
                    return (
                      <span
                        key={clientId}
                        title={movedHere ? `${clientId} — moved here from ${originCell}` : clientId}
                        style={{ background: cellColor(originCell) }}
                      />
                    );
                  })}
                  {residents.length > 60 && (
                    <span style={{ width: 'auto', height: 'auto', fontSize: '0.7rem', color: 'var(--muted)' }}>
                      +{residents.length - 60}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className={`value ${anyFailed ? 'bad' : ''}`}>{Math.round((moved / CLIENT_COUNT) * 100)}%</div>
            <div className="label">
              remapped — exactly the failed {failedCells.size === 1 ? "cell's" : "cells'"} keyspace
              share (~25% per cell, ±a few points of hash variance). Nobody else moves.
            </div>
          </div>
          <div className="stat">
            <div className={`value ${anyFailed ? 'good' : ''}`}>{100 - Math.round((moved / CLIENT_COUNT) * 100)}%</div>
            <div className="label">kept their original cell — same hash, same home</div>
          </div>
          <div className="stat">
            <div className={`value ${anyFailed ? 'bad' : ''}`}>
              {anyFailed ? `${Math.round((modMoved / CLIENT_COUNT) * 100)}%` : '—'}
            </div>
            <div className="label">
              would have moved under naive hash&nbsp;mod&nbsp;N — shrinking N reshuffles nearly
              everyone
            </div>
          </div>
          <div className="stat">
            <div className="value">{liveCells.length}/{CELL_COUNT}</div>
            <div className="label">cells healthy</div>
          </div>
        </div>
    </div>
  );
};

const KillCell: React.FC = () => {
  return (
    <section className="lesson" id="kill-a-cell">
      <div className="kicker">04 · Fault isolation</div>
      <h2>Kill a cell. Watch who moves.</h2>
      <p>
        This is the payoff. {CLIENT_COUNT} clients are pinned to {CELL_COUNT} cells. Click a cell to
        fail it: its virtual nodes vanish from the ring, and <em>only its clients</em> slide
        clockwise into the surviving cells — watch them arrive still wearing their old cell's
        color. Everyone else keeps the exact same assignment — no global reshuffle, no stampede,
        no cold caches for the unaffected 75%.
      </p>
      <KillCellDemo />
      <div className="callout">
        <strong>Compare that to naive routing:</strong> if you routed with <code>hash(id) mod N</code>{' '}
        and N dropped from 4 to 3, nearly <em>every</em> client would land in a different cell —
        a 100% reshuffle triggered by one failure. Consistent hashing keeps the damage proportional
        to the loss. (Recover the cell and its clients return home, too.)
      </div>
      <TryLive>Deactivate a real cell in the admin dashboard and watch live clients remap</TryLive>
    </section>
  );
};

export default KillCell;
