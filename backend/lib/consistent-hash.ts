import MD5 from 'crypto-js/md5';

export interface Cell {
  cellId: string;
  region: string;
  availabilityZone: string;
  /** Fractional multiplier of virtualNodes (1.0 = normal share, 2.0 = double). */
  weight: number;
  active: boolean;
}

export interface HashRing {
  ring: Map<number, Cell>;
  sortedKeys: number[];
}

export class ConsistentHash {
  private virtualNodes: number;
  private hashRing: HashRing;

  constructor(virtualNodes: number = 150) {
    this.virtualNodes = virtualNodes;
    this.hashRing = {
      ring: new Map(),
      sortedKeys: []
    };
  }

  private hash(key: string): number {
    // First 4 bytes of the MD5 digest as an unsigned big-endian 32-bit int.
    // crypto-js (instead of node:crypto) keeps this module isomorphic so the
    // admin dashboard and the educational site can run the exact same ring.
    return MD5(key).words[0] >>> 0;
  }

  addCell(cell: Cell): void {
    if (!cell.active) return;

    const nodesPerCell = Math.floor(this.virtualNodes * cell.weight);
    
    for (let i = 0; i < nodesPerCell; i++) {
      const virtualKey = `${cell.cellId}:${i}`;
      const hashValue = this.hash(virtualKey);
      this.hashRing.ring.set(hashValue, cell);
    }

    this.updateSortedKeys();
  }

  removeCell(cellId: string): void {
    const keysToRemove: number[] = [];
    
    this.hashRing.ring.forEach((cell, key) => {
      if (cell.cellId === cellId) {
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach(key => {
      this.hashRing.ring.delete(key);
    });

    this.updateSortedKeys();
  }

  private updateSortedKeys(): void {
    this.hashRing.sortedKeys = Array.from(this.hashRing.ring.keys()).sort((a, b) => a - b);
  }

  getCell(clientId: string): Cell | null {
    if (this.hashRing.sortedKeys.length === 0) {
      return null;
    }

    const hashValue = this.hash(clientId);
    
    let left = 0;
    let right = this.hashRing.sortedKeys.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (this.hashRing.sortedKeys[mid] === hashValue) {
        return this.hashRing.ring.get(this.hashRing.sortedKeys[mid]) || null;
      }
      if (this.hashRing.sortedKeys[mid] < hashValue) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    const index = left >= this.hashRing.sortedKeys.length ? 0 : left;
    return this.hashRing.ring.get(this.hashRing.sortedKeys[index]) || null;
  }

  getCellDistribution(): Map<string, number> {
    const distribution = new Map<string, number>();
    
    this.hashRing.ring.forEach((cell) => {
      const count = distribution.get(cell.cellId) || 0;
      distribution.set(cell.cellId, count + 1);
    });
    
    return distribution;
  }

  getRingVisualization(): Array<{position: number, cellId: string, region: string, az: string}> {
    const visualization: Array<{position: number, cellId: string, region: string, az: string}> = [];
    
    this.hashRing.sortedKeys.forEach(key => {
      const cell = this.hashRing.ring.get(key);
      if (cell) {
        visualization.push({
          position: key,
          cellId: cell.cellId,
          region: cell.region,
          az: cell.availabilityZone
        });
      }
    });
    
    return visualization;
  }

  rebuildFromCells(cells: Cell[]): void {
    this.hashRing.ring.clear();
    this.hashRing.sortedKeys = [];
    
    cells.forEach(cell => {
      this.addCell(cell);
    });
  }
}