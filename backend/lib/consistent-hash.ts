import * as crypto from 'crypto';

export interface Cell {
  cellId: string;
  region: string;
  availabilityZone: string;
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
    const hash = crypto.createHash('md5').update(key).digest();
    return hash.readUInt32BE(0);
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