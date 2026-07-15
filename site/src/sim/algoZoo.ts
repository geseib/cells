import { hashKey, MAX_HASH, CELL_COLOR_VARS } from './simulation';
import { ConsistentHash } from '../lib/hash';

/**
 * The algorithm zoo's shared mini-demo scenario: one worker list and one set
 * of 100 sample keys, fed to six consistent-hashing algorithms (plus naive
 * hash % N as the control group). Every algorithm here is a pure function of
 * (workers, key) — no hidden state — which is what the Playwright guards
 * assert. Where an algorithm calls for a generic hash we use the site's
 * hashKey (first 4 bytes of MD5, big-endian), the same primitive as the real
 * ring, so the cards stay in the site's one-hash world.
 */

/* ---- the shared scenario ---- */

export const ZOO_KEYS: string[] = Array.from({ length: 100 }, (_, i) => `key-${i}`);

/** The fixed key whose journey the rendezvous / multi-probe / CRUSH cards spotlight. */
export const ZOO_SPOTLIGHT_KEY = 'key-7';

export const ZOO_MIN_WORKERS = 2;
export const ZOO_MAX_WORKERS = 8;
export const ZOO_INITIAL_WORKERS = 5;

export const workerName = (i: number): string => `W${i + 1}`;

export function makeWorkers(n: number): string[] {
  return Array.from({ length: n }, (_, i) => workerName(i));
}

export function workerColor(worker: string): string {
  const i = parseInt(worker.slice(1), 10) - 1;
  return CELL_COLOR_VARS[(i >= 0 ? i : 0) % CELL_COLOR_VARS.length];
}

export type AlgoKey = 'ring' | 'rendezvous' | 'jump' | 'maglev' | 'multiprobe' | 'crush' | 'modn';

export const ALGO_KEYS: AlgoKey[] = ['ring', 'rendezvous', 'jump', 'maglev', 'multiprobe', 'crush', 'modn'];

export type Assignment = Map<string, string>; // key -> worker

/* ---- 1 · classic ring + virtual nodes ---- */

/** Low vnode count so the mini ring's arcs stay legible at 120px. */
export const ZOO_VNODES = 40;

export function buildZooRing(workers: string[]): ConsistentHash {
  const ring = new ConsistentHash(ZOO_VNODES);
  ring.rebuildFromCells(
    workers.map((w) => ({
      cellId: w,
      region: 'demo',
      availabilityZone: 'demo',
      weight: 1,
      active: true,
    }))
  );
  return ring;
}

export function ringAssign(workers: string[]): Assignment {
  const ring = buildZooRing(workers);
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) {
    const cell = ring.getCell(key);
    if (cell) out.set(key, cell.cellId);
  }
  return out;
}

/* ---- 2 · rendezvous / highest-random-weight ---- */

export const rendezvousScore = (key: string, worker: string): number => hashKey(`${key}:${worker}`);

export function rendezvousWinner(key: string, workers: string[]): string {
  let best = workers[0];
  let bestScore = -1;
  for (const w of workers) {
    const s = rendezvousScore(key, w);
    if (s > bestScore) {
      bestScore = s;
      best = w;
    }
  }
  return best;
}

export function rendezvousAssign(workers: string[]): Assignment {
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) out.set(key, rendezvousWinner(key, workers));
  return out;
}

/* ---- 3 · jump consistent hash (Lamping & Veach, faithful 64-bit LCG) ---- */

// BigInt exists in every browser this site targets; the tsconfig targets
// ES2018, so declare the constructor locally rather than bumping the lib
// (BigInt *literals* would need ES2020 syntax, hence BigInt('...') calls).
declare const BigInt: (value: string | number) => bigint;

const U64_MASK = (BigInt(1) << BigInt(64)) - BigInt(1);
const LCG_MULT = BigInt('2862933555777941757');
const ONE = BigInt(1);
const TWO_31 = BigInt(1) << BigInt(31);
const SHIFT_33 = BigInt(33);

/**
 * The published algorithm, verbatim: 64-bit LCG (key = key * 2862933555777941757 + 1
 * mod 2^64), jumping forward until the candidate bucket passes numBuckets.
 * Golden value (locked by the Playwright guard): jumpHash(123456789n, 10) === 7.
 */
export function jumpHash(key: bigint, numBuckets: number): number {
  let k = key & U64_MASK;
  let b = BigInt(-1);
  let j = BigInt(0);
  const n = BigInt(numBuckets);
  while (j < n) {
    b = j;
    k = (k * LCG_MULT + ONE) & U64_MASK;
    j = ((b + ONE) * TWO_31) / ((k >> SHIFT_33) + ONE);
  }
  return Number(b);
}

/** Jump wants a 64-bit integer key: two independent md5 words glued together. */
export function key64(key: string): bigint {
  return (BigInt(hashKey(key)) << BigInt(32)) | BigInt(hashKey(`${key}/lo`));
}

export function jumpBucket(key: string, numBuckets: number): number {
  return jumpHash(key64(key), numBuckets);
}

export function jumpAssign(workers: string[]): Assignment {
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) out.set(key, workers[jumpBucket(key, workers.length)]);
  return out;
}

/* ---- 4 · maglev lookup table ---- */

/**
 * 251 (prime) keeps the demo table legible as a 300px strip; real Maglev uses
 * 65537. Faithful build: each worker gets an (offset, skip) permutation of the
 * table from two hashes of its name and claims slots round-robin until full.
 */
export const MAGLEV_TABLE_SIZE = 251;

export function buildMaglevTable(workers: string[], size: number = MAGLEV_TABLE_SIZE): string[] {
  const n = workers.length;
  const offsets = workers.map((w) => hashKey(`${w}:offset`) % size);
  const skips = workers.map((w) => (hashKey(`${w}:skip`) % (size - 1)) + 1);
  const next = new Array<number>(n).fill(0);
  const table = new Array<number>(size).fill(-1);
  let filled = 0;
  while (filled < size) {
    for (let i = 0; i < n && filled < size; i++) {
      let c = (offsets[i] + next[i] * skips[i]) % size;
      while (table[c] >= 0) {
        next[i]++;
        c = (offsets[i] + next[i] * skips[i]) % size;
      }
      table[c] = i;
      next[i]++;
      filled++;
    }
  }
  return table.map((i) => workers[i]);
}

export function maglevAssign(workers: string[], table?: string[]): Assignment {
  const t = table ?? buildMaglevTable(workers);
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) out.set(key, t[hashKey(key) % t.length]);
  return out;
}

/* ---- 5 · multi-probe consistent hashing ---- */

export const MULTIPROBE_K = 5;

/** Each worker owns exactly ONE point on the ring — no virtual nodes. */
export const multiProbeWorkerPoint = (worker: string): number => hashKey(worker);

export interface ProbeDetail {
  /** Ring position of this probe of the key. */
  position: number;
  /** Closest worker (clockwise successor) for this probe. */
  worker: string;
  /** Clockwise distance from the probe to that worker's point. */
  distance: number;
}

export interface MultiProbeResult {
  probes: ProbeDetail[];
  /** Index into probes of the winning (minimal-distance) probe. */
  chosen: number;
}

/**
 * The published rule: hash the key k times; for each probe take the closest
 * worker point (clockwise successor, as on a ring); assign the key to the
 * worker of the probe with the smallest distance.
 */
export function multiProbeDetail(key: string, workers: string[]): MultiProbeResult {
  const points = workers.map((w) => ({ worker: w, point: multiProbeWorkerPoint(w) }));
  const probes: ProbeDetail[] = [];
  for (let i = 0; i < MULTIPROBE_K; i++) {
    const position = hashKey(`${key}#${i}`);
    let bestWorker = points[0].worker;
    let bestDist = Infinity;
    for (const { worker, point } of points) {
      const dist = (point - position + MAX_HASH) % MAX_HASH;
      if (dist < bestDist) {
        bestDist = dist;
        bestWorker = worker;
      }
    }
    probes.push({ position, worker: bestWorker, distance: bestDist });
  }
  let chosen = 0;
  for (let i = 1; i < probes.length; i++) {
    if (probes[i].distance < probes[chosen].distance) chosen = i;
  }
  return { probes, chosen };
}

export function multiProbeAssign(workers: string[]): Assignment {
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) {
    const { probes, chosen } = multiProbeDetail(key, workers);
    out.set(key, probes[chosen].worker);
  }
  return out;
}

/* ---- 6 · CRUSH, toy sketch: two racks + simplified straw selection ---- */

export const ZOO_RACKS = ['rack-1', 'rack-2'];

/** Deterministic rack membership: worker i lives in rack i % 2, so racks rebalance as workers come and go. */
export function rackMembers(workers: string[]): string[][] {
  const racks: string[][] = ZOO_RACKS.map(() => []);
  workers.forEach((w, i) => racks[i % ZOO_RACKS.length].push(w));
  return racks;
}

export interface CrushResult {
  rackIndex: number;
  worker: string;
  rackScores: number[];
}

/**
 * Simplified straw selection (straw2's shape): each candidate draws a straw
 * scaled by its weight — score = ln(u) / weight with u = hash-derived uniform
 * in (0, 1] — and the longest straw wins. Racks are weighted by how many
 * workers they hold; workers inside a rack are equal-weight, so their straw
 * comparison reduces to picking the max hash.
 */
export function crushDetail(key: string, workers: string[]): CrushResult {
  const racks = rackMembers(workers);
  const rackScores = racks.map((members, i) => {
    if (members.length === 0) return -Infinity;
    const u = (hashKey(`${key}@${ZOO_RACKS[i]}`) + 1) / MAX_HASH;
    return Math.log(u) / members.length;
  });
  let rackIndex = 0;
  for (let i = 1; i < rackScores.length; i++) {
    if (rackScores[i] > rackScores[rackIndex]) rackIndex = i;
  }
  const members = racks[rackIndex];
  let worker = members[0];
  let best = -1;
  for (const w of members) {
    const s = hashKey(`${key}@${w}`);
    if (s > best) {
      best = s;
      worker = w;
    }
  }
  return { rackIndex, worker, rackScores };
}

export function crushAssign(workers: string[]): Assignment {
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) out.set(key, crushDetail(key, workers).worker);
  return out;
}

/* ---- 7 · the control group: naive hash % N ---- */

export function modNAssign(workers: string[]): Assignment {
  const out: Assignment = new Map();
  for (const key of ZOO_KEYS) out.set(key, workers[hashKey(key) % workers.length]);
  return out;
}

/* ---- the shared snapshot ---- */

export interface ZooSnapshot {
  workers: string[];
  assignments: Record<AlgoKey, Assignment>;
  maglevTable: string[];
}

export function computeSnapshot(workers: string[]): ZooSnapshot {
  const maglevTable = buildMaglevTable(workers);
  return {
    workers: [...workers],
    assignments: {
      ring: ringAssign(workers),
      rendezvous: rendezvousAssign(workers),
      jump: jumpAssign(workers),
      maglev: maglevAssign(workers, maglevTable),
      multiprobe: multiProbeAssign(workers),
      crush: crushAssign(workers),
      modn: modNAssign(workers),
    },
    maglevTable,
  };
}

export function countMovedKeys(before: Assignment, after: Assignment): number {
  let moved = 0;
  for (const [key, worker] of before) {
    if (after.get(key) !== worker) moved++;
  }
  return moved;
}

export function movedBetween(before: ZooSnapshot, after: ZooSnapshot): Record<AlgoKey, number> {
  const out = {} as Record<AlgoKey, number>;
  for (const algo of ALGO_KEYS) {
    out[algo] = countMovedKeys(before.assignments[algo], after.assignments[algo]);
  }
  return out;
}

export function countChangedSlots(before: string[], after: string[]): number {
  let changed = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) changed++;
  }
  return changed;
}

/** Keys per worker, in worker order (for the count bars / strip widths). */
export function countsPerWorker(assignment: Assignment, workers: string[]): number[] {
  const index = new Map(workers.map((w, i) => [w, i]));
  const counts = new Array<number>(workers.length).fill(0);
  assignment.forEach((worker) => {
    const i = index.get(worker);
    if (i !== undefined) counts[i]++;
  });
  return counts;
}

/* ---- test hooks (consumed by the Playwright correctness guards) ---- */

const toPlain = (m: Assignment): Record<string, string> => {
  const o: Record<string, string> = {};
  m.forEach((v, k) => {
    o[k] = v;
  });
  return o;
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__algoZoo = {
    keys: ZOO_KEYS,
    makeWorkers,
    jumpHash: (keyDecimal: string, numBuckets: number) => jumpHash(BigInt(keyDecimal), numBuckets),
    jumpBuckets: (numBuckets: number) => ZOO_KEYS.map((k) => jumpBucket(k, numBuckets)),
    buildMaglevTable: (n: number) => buildMaglevTable(makeWorkers(n)),
    assignAll: (n: number) => {
      const snap = computeSnapshot(makeWorkers(n));
      const assignments: Record<string, Record<string, string>> = {};
      for (const algo of ALGO_KEYS) assignments[algo] = toPlain(snap.assignments[algo]);
      return { workers: snap.workers, assignments, maglevTable: snap.maglevTable };
    },
  };
}
