import React from 'react';
import WhyCells from './sections/WhyCells';
import HashRing from './sections/HashRing';
import RouteClient from './sections/RouteClient';
import KillCell from './sections/KillCell';
import Scale from './sections/Scale';
import TradeOffs from './sections/TradeOffs';

const App: React.FC = () => (
  <>
    <nav className="top-nav" aria-label="Sections">
      <span className="brand">🧫 Cells</span>
      <a href="#why-cells">Why cells</a>
      <a href="#hash-ring">The ring</a>
      <a href="#route-a-client">Routing</a>
      <a href="#kill-a-cell">Failure</a>
      <a href="#scale">Scaling</a>
      <a href="#trade-offs">Trade-offs</a>
    </nav>
    <header className="hero">
      <h1>Cell-Based Architecture</h1>
      <p className="lede">
        How AWS, Netflix, and Slack shrink outages from "everyone" to "a few percent": partition
        the workload into isolated cells and route every client to exactly one. Everything below is
        interactive and runs in your browser — powered by the same consistent-hashing code this
        repository deploys to AWS.
      </p>
    </header>
    <main>
      <WhyCells />
      <HashRing />
      <RouteClient />
      <KillCell />
      <Scale />
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
