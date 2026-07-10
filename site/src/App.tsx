import React, { useMemo } from 'react';
import WhyCells from './sections/WhyCells';
import HashRing from './sections/HashRing';
import RouteClient from './sections/RouteClient';
import KillCell from './sections/KillCell';
import Scale from './sections/Scale';
import BeyondCells from './sections/BeyondCells';
import TradeOffs from './sections/TradeOffs';
import { arcPath, buildRing, cellColor, makeCells, ownershipArcs } from './sim/simulation';
import { demoAdminUrl, hasLiveDemo } from './TryLive';

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

const App: React.FC = () => (
  <>
    <nav className="top-nav" aria-label="Sections">
      <span className="brand"><RingMark size={18} band={5} vnodes={4} /> Cells</span>
      <a href="./primer.html">Primer</a>
      <a href="#why-cells">Why cells</a>
      <a href="#hash-ring">The ring</a>
      <a href="#route-a-client">Routing</a>
      <a href="#kill-a-cell">Failure</a>
      <a href="#scale">Scaling</a>
      <a href="#beyond-cells">Beyond cells</a>
      <a href="#trade-offs">Trade-offs</a>
      {hasLiveDemo && (
        <>
          <span style={{ flex: 1 }} />
          <a href={demoAdminUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
            Live demo ↗
          </a>
        </>
      )}
    </nav>
    <header className="hero">
      <h1>Cell-Based Architecture</h1>
      <p className="lede">
        How AWS, Netflix, and Slack shrink outages from "everyone" to "a few percent": partition
        the workload into isolated cells and route every client to exactly one. Everything below is
        interactive and runs in your browser — powered by the same consistent-hashing code this
        repository deploys to AWS. New to the problem itself? Start with the{' '}
        <a href="./primer.html">cloud-neutral primer</a>.
      </p>
      <RingMark className="hero-ring" size={240} band={4} vnodes={36} />
    </header>
    <main>
      <WhyCells />
      <HashRing />
      <RouteClient />
      <KillCell />
      <Scale />
      <BeyondCells />
      <TradeOffs />
    </main>
    <footer className="site-footer">
      Built as an educational companion to the{' '}
      <a href="https://github.com/geseib/cells" target="_blank" rel="noopener noreferrer">
        cells
      </a>{' '}
      repository · MIT licensed
    </footer>
  </>
);

export default App;
