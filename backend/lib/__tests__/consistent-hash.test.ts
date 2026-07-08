import * as crypto from 'crypto';
import MD5 from 'crypto-js/md5';
import { Cell, ConsistentHash } from '../consistent-hash';

const makeCell = (id: string, overrides: Partial<Cell> = {}): Cell => ({
  cellId: id,
  region: 'us-east-1',
  availabilityZone: `${id}-az`,
  weight: 1,
  active: true,
  ...overrides,
});

const CELL_IDS = ['cell-a', 'cell-b', 'cell-c', 'cell-d'];

const buildRing = (cells: Cell[] = CELL_IDS.map((id) => makeCell(id))): ConsistentHash => {
  const ring = new ConsistentHash();
  ring.rebuildFromCells(cells);
  return ring;
};

const clientIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `client-${i}`);

describe('hash function', () => {
  // Golden values anchor the algorithm: MD5 digest, first 4 bytes, big-endian,
  // unsigned. The educational site and admin dashboard rely on this exact
  // mapping matching the backend — do not change these without changing all
  // three consumers together.
  const GOLDEN: Array<[string, number]> = [
    ['user123', 1792101289],
    ['customer456', 1537836496],
    ['test-client', 1649546824],
  ];

  test.each(GOLDEN)('crypto-js MD5 uint32 of %s matches golden value', (key, expected) => {
    expect(MD5(key).words[0] >>> 0).toBe(expected);
  });

  test('crypto-js matches node:crypto for arbitrary keys', () => {
    for (const key of clientIds(100)) {
      const nodeValue = crypto.createHash('md5').update(key).digest().readUInt32BE(0);
      expect(MD5(key).words[0] >>> 0).toBe(nodeValue);
    }
  });
});

describe('ConsistentHash', () => {
  test('routes every client to a cell, deterministically', () => {
    const ring = buildRing();
    for (const id of clientIds(50)) {
      const first = ring.getCell(id);
      expect(first).not.toBeNull();
      expect(ring.getCell(id)!.cellId).toBe(first!.cellId);
    }
  });

  test('distributes clients roughly evenly across equal-weight cells', () => {
    const ring = buildRing();
    const counts = new Map<string, number>();
    const N = 4000;
    for (const id of clientIds(N)) {
      const cell = ring.getCell(id)!;
      counts.set(cell.cellId, (counts.get(cell.cellId) || 0) + 1);
    }
    expect(counts.size).toBe(CELL_IDS.length);
    for (const [, count] of counts) {
      // Each of 4 cells should get 25% ± 10 percentage points
      expect(count / N).toBeGreaterThan(0.15);
      expect(count / N).toBeLessThan(0.35);
    }
  });

  test('removing a cell only remaps that cell\'s clients', () => {
    const ring = buildRing();
    const before = new Map<string, string>();
    for (const id of clientIds(1000)) {
      before.set(id, ring.getCell(id)!.cellId);
    }

    const removed = 'cell-b';
    ring.removeCell(removed);

    let remapped = 0;
    for (const [id, prevCell] of before) {
      const nowCell = ring.getCell(id)!.cellId;
      expect(nowCell).not.toBe(removed);
      if (prevCell !== removed) {
        // Clients in surviving cells must be completely unaffected
        expect(nowCell).toBe(prevCell);
      } else {
        remapped++;
      }
    }
    // Only the failed cell's share (~1/4) moved
    expect(remapped / before.size).toBeGreaterThan(0.1);
    expect(remapped / before.size).toBeLessThan(0.4);
  });

  test('a cell with weight 2.0 owns roughly double the keyspace', () => {
    const cells = [makeCell('heavy', { weight: 2 }), makeCell('light-1'), makeCell('light-2')];
    const ring = buildRing(cells);

    const counts = new Map<string, number>();
    const N = 4000;
    for (const id of clientIds(N)) {
      const cell = ring.getCell(id)!;
      counts.set(cell.cellId, (counts.get(cell.cellId) || 0) + 1);
    }

    const heavy = counts.get('heavy')! / N;
    const light = (counts.get('light-1')! + counts.get('light-2')!) / (2 * N);
    expect(heavy / light).toBeGreaterThan(1.5);
    expect(heavy / light).toBeLessThan(2.6);
  });

  test('inactive cells are excluded from the ring', () => {
    const cells = [makeCell('up'), makeCell('down', { active: false })];
    const ring = buildRing(cells);
    for (const id of clientIds(100)) {
      expect(ring.getCell(id)!.cellId).toBe('up');
    }
    expect(ring.getCellDistribution().has('down')).toBe(false);
  });

  test('returns null when the ring is empty', () => {
    const ring = new ConsistentHash();
    expect(ring.getCell('anyone')).toBeNull();
  });
});
