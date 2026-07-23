import { ComponentType, LazyExoticComponent, lazy } from 'react';

/**
 * The single source of truth for the guide hub: the ten sections, their
 * order, grouping, menu-card copy, and hash resolution. Everything reads
 * from here — menu cards, bottom nav, the top-nav position indicator, the
 * vote overlay's section list, ballot completeness, and the Playwright
 * kicker-drift guard.
 */

export interface SectionDef {
  /**
   * URL hash AND ballot key — NEVER change an id. Persisted votes and
   * external deep links (primer, RoadToCells, old operations fragments)
   * are keyed on these.
   */
  id: string;
  /** Two-digit position, '01'..'10'. */
  num: string;
  /** Short human title (menu card, bottom nav, position indicator). */
  title: string;
  /** Must match the section's rendered `.kicker` text (spec-checked). */
  kicker: string;
  /** Menu-card copy, ≤30 words. */
  blurb: string;
  group: GroupName;
  Component: LazyExoticComponent<ComponentType>;
}

export const GROUPS = [
  'Foundations',
  'Failure & scale',
  'Deeper patterns',
  'Control planes & closing',
] as const;
export type GroupName = (typeof GROUPS)[number];

export const SECTIONS: SectionDef[] = [
  {
    id: 'why-cells',
    num: '01',
    title: 'Why cells',
    kicker: '01 · The problem',
    blurb:
      'Blast radius: why one shared fleet fails everyone at once, and how partitioning the same servers into isolated cells turns a total outage into a fraction.',
    group: 'Foundations',
    Component: lazy(() => import('../sections/WhyCells')),
  },
  {
    id: 'hash-ring',
    num: '02',
    title: 'The hash ring',
    kicker: '02 · The mechanism',
    blurb:
      'MD5, virtual nodes, and the ring that maps every client to exactly one cell — the same consistent-hashing code this repository deploys to AWS.',
    group: 'Foundations',
    Component: lazy(() => import('../sections/HashRing')),
  },
  {
    id: 'route-a-client',
    num: '03',
    title: 'Route a client',
    kicker: '03 · Determinism',
    blurb:
      'Type a client ID, watch it hash to a point on the ring, and prove the answer never changes — no lookup table required.',
    group: 'Foundations',
    Component: lazy(() => import('../sections/RouteClient')),
  },
  {
    id: 'kill-a-cell',
    num: '04',
    title: 'Kill a cell',
    kicker: '04 · Fault isolation',
    blurb:
      'Kill one cell and watch who moves: only its own clients. Fault isolation, measured live — the blast radius arithmetic from lesson 01, kept honest.',
    group: 'Failure & scale',
    Component: lazy(() => import('../sections/KillCell')),
  },
  {
    id: 'idempotency',
    num: '05',
    title: 'Safe retries',
    kicker: '05 · Safe retries',
    blurb:
      'Failover means retries, and a retry is the same command twice. Replay a payment across regions and watch dedupe work — or guarantee a double charge.',
    group: 'Failure & scale',
    Component: lazy(() => import('../sections/Idempotency')),
  },
  {
    id: 'scale',
    num: '06',
    title: 'Scale out',
    kicker: '06 · Elasticity',
    blurb:
      'Add cells and watch consistent hashing move only the clients it must — elasticity without a global reshuffle.',
    group: 'Failure & scale',
    Component: lazy(() => import('../sections/Scale')),
  },
  {
    id: 'hash-choices',
    num: '07',
    title: 'Choosing your hash',
    kicker: '07 · The algorithm zoo',
    blurb:
      'Six hashing schemes race on distribution and churn — and why this project settled on MD5-first-4-bytes over a virtual-node ring.',
    group: 'Deeper patterns',
    Component: lazy(() => import('../sections/HashChoices')),
  },
  {
    id: 'beyond-cells',
    num: '08',
    title: 'Beyond cells',
    kicker: '08 · Beyond cells',
    blurb:
      'Shuffle sharding, static stability, constant work: the sibling patterns that show up next to cells in every serious architecture.',
    group: 'Deeper patterns',
    Component: lazy(() => import('../sections/BeyondCells')),
  },
  {
    id: 'consensus',
    num: '09',
    title: 'Consensus',
    kicker: '09 · Versioned truth',
    blurb:
      'Five health checkers outvote one liar, then five regions agree on an ordered ledger of decisions — quorum, consensus vs convergence, and Paxos → Raft.',
    group: 'Control planes & closing',
    Component: lazy(() => import('../sections/Consensus')),
  },
  {
    id: 'trade-offs',
    num: '10',
    title: 'Trade-offs',
    kicker: '10 · The fine print',
    blurb:
      'The fine print: what cells cost you — a router you must keep sacred, cross-cell features that hurt, and capacity that fragments.',
    group: 'Control planes & closing',
    Component: lazy(() => import('../sections/TradeOffs')),
  },
];

export const SECTION_INDEX: Record<string, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s])
);

/**
 * Non-section anchors that deep-link INTO a section view. The key is the
 * legacy/inner anchor, the value is the section view that hosts it; the
 * original fragment is preserved as the scroll target.
 */
export const ANCHOR_ALIASES: Record<string, string> = {
  'sidequest-registry': 'route-a-client',
  quorum: 'consensus',
  'paxos-raft': 'consensus',
  reading: 'consensus',
};

export interface ResolvedHash {
  /** 'menu' or a section id. */
  view: string;
  /** Inner element id to scroll to once the view has mounted. */
  scrollTo?: string;
}

/**
 * location.hash → view. Tolerates '#vote=on'-style flag fragments and any
 * unknown hash (both resolve to the menu — never crash).
 */
export function resolveHash(hash: string): ResolvedHash {
  let h = (hash || '').replace(/^#/, '');
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep the raw fragment */
  }
  if (!h || h === 'menu' || h.includes('=')) return { view: 'menu' };
  if (SECTION_INDEX[h]) return { view: h };
  const aliased = ANCHOR_ALIASES[h];
  if (aliased) return { view: aliased, scrollTo: h };
  return { view: 'menu' };
}
