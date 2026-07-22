import React from 'react';
import WhyCells from './sections/WhyCells';
import HashRing from './sections/HashRing';
import RouteClient from './sections/RouteClient';
import KillCell from './sections/KillCell';
import Scale from './sections/Scale';
import HashChoices from './sections/HashChoices';
import BeyondCells from './sections/BeyondCells';
import TradeOffs from './sections/TradeOffs';
import { demoAdminUrl, hasLiveDemo } from './TryLive';
import RingMark from './ui/RingMark';
import ThemeToggle from './ui/ThemeToggle';
import { VoteProvider } from './vote/VoteContext';
import VoteOverlay from './vote/VoteOverlay';
import NavVoteButton from './vote/NavVoteButton';

const App: React.FC = () => (
  <VoteProvider
    pageId="guide"
    pageTitle="Cell-Based Architecture — Interactive Guide"
    siteName="cells"
  >
    <nav className="top-nav" aria-label="Sections">
      <span className="brand"><RingMark size={18} band={5} vnodes={4} /> Cells</span>
      <a href="#why-cells">Why cells</a>
      <a href="#hash-ring">The ring</a>
      <a href="#route-a-client">Routing</a>
      <a href="#kill-a-cell">Failure</a>
      <a href="#scale">Scaling</a>
      <a href="#hash-choices">Hashing</a>
      <a href="#beyond-cells">Beyond cells</a>
      <a href="#trade-offs">Trade-offs</a>
      <span style={{ flex: 1 }} />
      <a href="./primer.html" style={{ fontWeight: 600 }}>Primer</a>
      <a href="./slides.html" style={{ fontWeight: 600 }}>Slides</a>
      <a href="./operations.html" style={{ fontWeight: 600 }}>Operations</a>
      {hasLiveDemo && (
        <a href={demoAdminUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
          Live demo ↗
        </a>
      )}
      <NavVoteButton />
      <ThemeToggle />
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
      <HashChoices />
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
    <VoteOverlay sectionSelector="main > section.lesson" />
  </VoteProvider>
);

export default App;
