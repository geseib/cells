// SVG donut-ring helpers for the hash-ring visualization.
//
// Ported from site/src/sim/simulation.ts — the position math must stay
// identical so the admin dashboard draws the exact ring the backend routes
// with. All positions are real uint32 hash values (0 .. 2^32) returned by the
// admin API; nothing here re-hashes anything.

export const MAX_HASH = 0x100000000; // 2^32

export interface RingNode {
  position: number;
  cellId: string;
  region: string;
  az: string;
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
 * next node). Expects real ring data from GET /admin/hash-ring.
 */
export function ownershipArcs(ring: RingNode[]): OwnershipArc[] {
  if (ring.length === 0) return [];
  const nodes = [...ring].sort((a, b) => a.position - b.position);
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
export function pointOnCircle(
  cx: number,
  cy: number,
  r: number,
  frac: number
): { x: number; y: number } {
  const angle = frac * 2 * Math.PI - Math.PI / 2;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

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

/**
 * Stable cellId → color assignment: colors follow sorted cellId order over
 * the full set of registered cells, so a cell keeps its color when others
 * are activated or deactivated.
 */
export function makeCellColors(cellIds: string[]): (cellId: string) => string {
  const sorted = [...new Set(cellIds)].sort((a, b) => a.localeCompare(b));
  const index = new Map(sorted.map((id, i) => [id, i]));
  return (cellId: string) => {
    const i = index.get(cellId);
    return CELL_COLOR_VARS[(i !== undefined ? i : 0) % CELL_COLOR_VARS.length];
  };
}
