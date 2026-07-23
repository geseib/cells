import React from 'react';
import Icon from '../ui/icons';

const TradeOffs: React.FC = () => (
  <section className="lesson" id="trade-offs">
    <div className="kicker">10 · The fine print</div>
    <h2>Trade-offs and design decisions</h2>
    <p>
      Cells aren't free. The pattern trades global simplicity for bounded failure — these are the
      questions every cell-based design has to answer.
    </p>
    <div className="tradeoff-grid">
      <div className="panel">
        <h3><Icon name="database" size={18} />Data partitioning</h3>
        <p>
          Each cell owns its clients' data. That's what makes failure containment real — but it
          means cross-client features (search, analytics, leaderboards) need an aggregation path
          outside the cells, and moving a client between cells means migrating their data.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="maximize" size={18} />Cell sizing</h3>
        <p>
          Small cells → small blast radius but more operational overhead; big cells → the opposite.
          A common approach: pick a maximum cell size you can load-test to, and add cells before
          any one approaches it. Never let a cell grow past what you've proven it can handle.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="compass" size={18} />The router is sacred — or optional</h3>
        <p>
          The routing layer is the one component every request touches, so its availability bounds
          the whole system. Keep it as thin as possible. Better yet, notice that the ring is a
          pure function of the cell registry — <em>identical everywhere it runs</em>. So routing
          doesn't need to be a central service at all: every cell can run the same hash and
          redirect misrouted clients to their true home, or a smart client can compute its own
          cell locally. Then DNS is the only shared dependency left.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="shuffle" size={18} />Rebalancing & migration</h3>
        <p>
          Adding a cell moves ~1/N of clients — and their data. Plan for gradual migration: route
          new sessions to the new assignment while draining old ones, or move cohorts explicitly.
          Some systems pin clients with a mapping table instead of pure hashing to make migration
          fully controllable.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="waves" size={18} />Retry storms & shared deps</h3>
        <p>
          Isolation only holds if cells share nothing at runtime: no common database, no
          cross-cell calls, separate quotas per cell. One hidden shared dependency quietly
          reconnects all the failure domains you worked to separate.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="eye" size={18} />Observability per cell</h3>
        <p>
          Dashboards, alarms, and canaries should be per-cell, with the cell ID on every metric and
          log line. "Which cell is this user in?" should be answerable in seconds during an
          incident — that's why the demo pages display cell identity so loudly.
        </p>
      </div>
    </div>
    <div className="callout">
      <strong>Go deeper:</strong> the{' '}
      <a href="https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html" target="_blank" rel="noopener noreferrer">
        AWS whitepaper on cell-based architecture
      </a>{' '}
      covers the production version of everything on this page (the sibling patterns above have
      their own reading list). Then deploy this repo's real AWS implementation — Lambda, DynamoDB,
      CloudFront, one stack per cell — by following{' '}
      <a href="https://github.com/geseib/cells/blob/main/QUICKSTART.md" target="_blank" rel="noopener noreferrer">
        the quick start
      </a>
      .
    </div>
  </section>
);

export default TradeOffs;
