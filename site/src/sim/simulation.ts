import MD5 from 'crypto-js/md5';
import { Cell, ConsistentHash } from '../lib/hash';

/** Same computation the backend ring uses: first 4 bytes of MD5, big-endian, unsigned. */
export const hashKey = (key: string): number => MD5(key).words[0] >>> 0;

export const MAX_HASH = 0x100000000; // 2^32

/** CSS variables carry the palette so light/dark mode swap in one place. */
export const CELL_COLOR_VARS = [
  'var(--cell-1)',
  'var(--cell-2)',
  'var(--cell-3)',
  'var(--cell-4)',
  'var(--cell-5)',
  'var(--cell-6)',
  'var(--cell-7)',
  'var(--cell-8)',
];

export const FAILED_COLOR = 'var(--critical)';

const REGIONS = ['us-east-1', 'us-west-2'];
const AZS = ['a', 'b', 'c', 'd'];

export const CELL_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Build n demo cells spread across two regions and their AZs. */
export function makeCells(n: number): Cell[] {
  return Array.from({ length: n }, (_, i) => {
    const region = REGIONS[Math.floor(i / 2) % REGIONS.length];
    const az = AZS[i % 2 === 0 ? 0 : 1];
    return {
      cellId: `cell-${CELL_NAMES[i]}`,
      region,
      availabilityZone: `${region}${az}`,
      weight: 1,
      active: true,
    };
  });
}

export function cellColor(cellId: string): string {
  const index = CELL_NAMES.indexOf(cellId.replace('cell-', ''));
  return CELL_COLOR_VARS[index >= 0 ? index % CELL_COLOR_VARS.length : 0];
}

export function buildRing(cells: Cell[], virtualNodes = 150): ConsistentHash {
  const ring = new ConsistentHash(virtualNodes);
  ring.rebuildFromCells(cells);
  return ring;
}

export const clientIds = (n: number, prefix = 'client'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);

/** Map each client to its owning cellId. */
export function assign(clients: string[], ring: ConsistentHash): Map<string, string> {
  const result = new Map<string, string>();
  for (const id of clients) {
    const cell = ring.getCell(id);
    if (cell) result.set(id, cell.cellId);
  }
  return result;
}

/** How many clients changed cells between two assignments. */
export function countMoved(before: Map<string, string>, after: Map<string, string>): number {
  let moved = 0;
  for (const [id, cell] of before) {
    if (after.get(id) !== cell) moved++;
  }
  return moved;
}

export interface OwnershipArc {
  cellId: string;
  /** start/end as fractions of the full circle [0, 1) */
  start: number;
  end: number;
}

/**
 * Convert the ring's virtual nodes into ownership arcs: the arc ending at a
 * virtual node belongs to that node's cell (clients walk clockwise to the
 * next node).
 */
export function ownershipArcs(ring: ConsistentHash): OwnershipArc[] {
  const nodes = ring.getRingVisualization();
  if (nodes.length === 0) return [];
  const arcs: OwnershipArc[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const prev = i === 0 ? nodes[nodes.length - 1].position - MAX_HASH : nodes[i - 1].position;
    arcs.push({
      cellId: nodes[i].cellId,
      start: prev / MAX_HASH,
      end: nodes[i].position / MAX_HASH,
    });
  }
  return arcs;
}

/** Share of the keyspace each cell owns, as a fraction summing to 1. */
export function keyspaceShare(ring: ConsistentHash): Map<string, number> {
  const shares = new Map<string, number>();
  for (const arc of ownershipArcs(ring)) {
    shares.set(arc.cellId, (shares.get(arc.cellId) || 0) + (arc.end - arc.start));
  }
  return shares;
}

/** SVG path for a circular arc band (donut segment), fractions of a turn. */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startFrac: number,
  endFrac: number
): string {
  const startAngle = startFrac * 2 * Math.PI - Math.PI / 2;
  const endAngle = endFrac * 2 * Math.PI - Math.PI / 2;
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/** Point on a circle for a keyspace position given as a fraction of a turn. */
export function pointOnCircle(cx: number, cy: number, r: number, frac: number): { x: number; y: number } {
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}
