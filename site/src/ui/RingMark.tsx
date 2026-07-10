import React, { useMemo } from 'react';
import { arcPath, buildRing, cellColor, makeCells, ownershipArcs } from '../sim/simulation';

/** The hash ring as a quiet emblem: a thin band of cell-colored arcs. */
const RingMark: React.FC<{ size: number; band: number; vnodes: number; className?: string }> = ({
  size,
  band,
  vnodes,
  className,
}) => {
  const arcs = useMemo(() => ownershipArcs(buildRing(makeCells(4), vnodes)), [vnodes]);
  const c = size / 2;
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {arcs.map((arc, i) => (
        <path key={i} d={arcPath(c, c, c - 1, c - 1 - band, arc.start, arc.end)} fill={cellColor(arc.cellId)} />
      ))}
    </svg>
  );
};

export default RingMark;
