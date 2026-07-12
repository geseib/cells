import React, { useMemo } from 'react';
import RoadToCells from './RoadToCells';
import IsolationStepper from './IsolationStepper';
import { arcPath, buildRing, cellColor, makeCells, ownershipArcs } from '../sim/simulation';
import Icon from '../ui/icons';
import ThemeToggle from '../ui/ThemeToggle';
import { demoAdminUrl, hasLiveDemo } from '../TryLive';

/**
 * The primer: the problem from first principles, in nobody's cloud accent.
 * Deliberately vendor-neutral — the deep dive (index.html) is where the
 * hash ring, the AWS demo, and the interactive lessons live.
 */

/** Same quiet ring emblem as the main page (local copy: separate entry point). */
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

/* ------------------------------------------------------------------ */
/* 01 · First principles                                               */
/* ------------------------------------------------------------------ */

const TheRoad: React.FC = () => (
  <section className="lesson" id="road">
    <div className="kicker">01 · First principles</div>
    <h2>The road to cells</h2>
    <p>
      Nobody designs a distributed system on day one. You design a system, it succeeds, and
      success forces a sequence of moves on you — each one reasonable, each one solving the
      problem in front of you. Walk the sequence and watch what each move does to the{' '}
      <strong>failure domain</strong>: the set of things that break together.
    </p>
    <RoadToCells />
    <h3>The two words that matter</h3>
    <p>
      A <strong>failure domain</strong> is everything that shares fate with a given failure — one
      bad component, and everything in its domain has a bad day. The <strong>blast radius</strong>{' '}
      is that domain measured in victims: what fraction of your clients are standing inside it
      when something breaks. Steps 1 through 4 never change either number. A monolith is one
      failure domain. A bigger monolith is one failure domain. Twenty servers behind a load
      balancer, sharing a database, a deploy pipeline, and a configuration file? Still one
      failure domain — with better throughput.
    </p>
    <p>
      This is why traditional high availability keeps disappointing people. Redundancy defends
      against a <em>component</em> dying: a disk, a server, a power supply. It does nothing
      against a <em>mistake</em> being replicated: a bad deploy lands on every server, a poison
      request hits whichever server picks it up, a hot key melts the shared database that all
      the redundant servers faithfully share. The failures that make the news are almost never
      "a machine died". They're "a change went everywhere at once".
    </p>
    <p>
      The fix is the punchline of step 5: stop making the system bigger and start making{' '}
      <strong>more systems</strong>. Partition the workload into complete, independent copies —
      each with its own compute, its own data, its own everything — and pin every client to
      exactly one copy. Each copy is a failure domain with a wall around it, and the blast
      radius of anything that happens inside is, by arithmetic, 1/N. That copy is what the
      industry calls a <strong>cell</strong>.
    </p>
    <div className="callout">
      <strong>One honest requirement comes with it:</strong> something has to decide which
      client belongs to which cell, consistently, on every request — without becoming the new
      shared failure domain itself. That routing problem is the heart of the pattern, and it's
      exactly what the{' '}
      <a href="./index.html#why-cells">interactive deep dive</a> spends its time on: consistent
      hashing, draining a cell, and watching the blast radius shrink live.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 02 · Vocabulary                                                     */
/* ------------------------------------------------------------------ */

const CONCEPT_ROWS: [string, string, string, string][] = [
  [
    'The partition itself',
    '“Cell”',
    'Deployment stamp · scale unit',
    'Cell (Borg cells, mostly internal)',
  ],
  [
    'Global routing layer',
    'Route 53 + Application Recovery Controller',
    'Front Door · Traffic Manager',
    'Cloud Load Balancing',
  ],
  [
    'Datacenter-scale failure domain',
    'Availability Zone',
    'Availability zone',
    'Zone',
  ],
  [
    'Geographic failure domain',
    'Region',
    'Region',
    'Region',
  ],
  [
    'Where they wrote it down',
    'Well-Architected whitepaper on cell-based architecture',
    'Deployment Stamps pattern (Architecture Center)',
    'SRE book + research papers (Borg, Spanner)',
  ],
];

const COMPANY_ROWS: [string, string, string][] = [
  ['AWS', 'Cells', 'Documented it best — a whole Well-Architected whitepaper and years of re:Invent talks.'],
  ['Microsoft', 'Deployment stamps · scale units', 'Same pattern, filed under a different name in the Azure Architecture Center.'],
  ['Google', 'Cells · Borg cells · shards', 'Mostly internal vocabulary — it surfaces in research papers and the SRE book, not architecture guides.'],
  ['Netflix', 'Cells · regional isolation', 'Famous for evacuating an entire region on purpose, regularly, to prove they can.'],
  ['Slack', 'Cells', 'Workspace-keyed partitioning; wrote the best public migration story.'],
  ['Stripe', 'Shards + isolation domains', 'Payments: partitioning where correctness matters more than latency.'],
  ['Shopify', 'Pods', 'A pod is a shop’s whole stack. Built to survive one merchant’s flash sale.'],
  ['Uber', 'Cells · domains', 'Geography handed them a natural partition key: the city.'],
];

const Vocabulary: React.FC = () => (
  <section className="lesson" id="vocabulary">
    <div className="kicker">02 · Vocabulary</div>
    <h2>Same pattern, four accents</h2>
    <p>
      Here's the trap in researching this topic: search for "cell-based architecture" and you'll
      conclude it's an AWS idea. It isn't — AWS just documented it best. Every large cloud and
      every large internet company converged on the same shape and named it independently. Learn
      the four generic words and every vendor's docs become readable:
    </p>
    <div className="tradeoff-grid">
      <div className="panel">
        <h3><Icon name="target" size={18} />Partition</h3>
        <p>
          A slice of the workload — usually keyed by customer, tenant, or workspace — that lives
          entirely in one place. Not a copy of one layer: a slice through <em>all</em> of them.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="alert-triangle" size={18} />Failure domain</h3>
        <p>
          The set of things that break together. Every system has failure domains whether you
          drew them or not; the design act is making them smaller than "everything".
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="maximize" size={18} />Unit of scale</h3>
        <p>
          The thing you add more of when traffic grows. If growth means "add another identical
          partition" instead of "make the shared thing bigger", capacity planning becomes
          multiplication.
        </p>
      </div>
      <div className="panel">
        <h3><Icon name="compass" size={18} />Request router</h3>
        <p>
          The thin global layer that knows which partition owns which client. The one piece
          everyone shares — so it must stay small, boring, and hard to break.
        </p>
      </div>
    </div>
    <p style={{ marginTop: '1.5rem' }}>
      A <strong>cell</strong> is all four at once: a partition that is its own failure domain,
      used as the unit of scale, fronted by a request router. Now the translation table:
    </p>
    <div className="panel">
      <div className="table-scroll">
        <table className="data" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Concept</th>
              <th>AWS</th>
              <th>Microsoft Azure</th>
              <th>Google</th>
            </tr>
          </thead>
          <tbody>
            {CONCEPT_ROWS.map(([concept, aws, azure, google]) => (
              <tr key={concept}>
                <td style={{ fontWeight: 600 }}>{concept}</td>
                <td>{aws}</td>
                <td>{azure}</td>
                <td>{google}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <blockquote className="quote">
      Microsoft's own definition makes the bridge explicit: the Deployment Stamps article
      describes deploying many independent copies of a solution — data storage included — where
      each copy is a stamp, "sometimes called a cell, service unit, or scale unit".
      <footer>
        —{' '}
        <a
          href="https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp"
          target="_blank"
          rel="noopener noreferrer"
        >
          Deployment Stamps pattern
        </a>
        , Azure Architecture Center
      </footer>
    </blockquote>
    <p>
      And in the wild, where the pattern predates most of the documentation:
    </p>
    <div className="panel">
      <div className="table-scroll">
        <table className="data" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Who</th>
              <th>What they call it</th>
              <th>The flavor</th>
            </tr>
          </thead>
          <tbody>
            {COMPANY_ROWS.map(([who, name, note]) => (
              <tr key={who}>
                <td style={{ fontWeight: 600 }}>{who}</td>
                <td>{name}</td>
                <td>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <div className="callout">
      <strong>The takeaway:</strong> learn the pattern once, then treat "cell", "stamp", "pod",
      and "shard-plus-its-stack" as regional dialects. When a vendor doc says "scale unit",
      your translation is: a partition with a wall around it.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 03 · Disambiguation                                                 */
/* ------------------------------------------------------------------ */

const SIBLING_ROWS: [string, string, string, string][] = [
  [
    'Availability Zone',
    'The provider’s physical plant',
    'Physical failures: power, cooling, network, fire',
    'The regional control plane — one bug hits every zone',
  ],
  [
    'Region',
    'The provider’s geography and control plane',
    'Metro-scale disasters; regional control-plane failures',
    'Cross-region routing and replication — yours to build',
  ],
  [
    'Microservice',
    'Your codebase, by function',
    'One function’s faults, in its own process',
    'The request path — synchronous call chains re-couple everything',
  ],
  [
    'Shard',
    'The data, by key range',
    'One key range’s hot keys, growth, and corruption',
    'Compute and control plane — and the system-level complexity',
  ],
  [
    'Kubernetes namespace',
    'API objects and quotas in one cluster',
    'Noisy neighbors’ resource budgets',
    'The cluster’s control plane: one API server, one etcd',
  ],
  [
    'Cell / deployment stamp',
    'The whole system, by client or tenant',
    'Software failures: bad deploys, poison requests, data corruption',
    'Only the routing layer — thin by design, and you own the slice',
  ],
];

const SameThing: React.FC = () => (
  <section className="lesson" id="same-thing">
    <div className="kicker">03 · Disambiguation</div>
    <h2>"Aren't these all the same thing?"</h2>
    <p>
      No — and the difference is best read on two axes: <strong>what dependency class each one
      isolates</strong>, and <strong>what it leaves coupled</strong>. Zones wall off the physics
      but usually share a control plane; regions split the control plane but leave the bridge
      between them to you; microservices isolate one function's faults while synchronous calls
      re-couple the system; shards isolate the data while compute stays shared. Each concept
      builds one wall and leaves the system-level coupling standing. Step through them — solid
      means isolated, dashed means still shared — and watch what's left dashed on each step:
    </p>
    <IsolationStepper />
    <p style={{ marginTop: '1.5rem' }}>
      The arc of those six steps is the point: <strong>cells and deployment stamps aren't
      another wall — they're the composition</strong>. A cell takes the isolation and scaling
      units the other concepts provide (zones for physics, services for code, shards for data)
      and groups them into replicas of the entire system, each serving a slice of clients that
      your routing layer decides. That's why the failures cells contain are the ones that make
      the news: bad deploys, poison requests, data corruption — mistakes, which replicate
      through anything shared and stop only at a system-level wall. The same map, in table
      form:
    </p>
    <div className="panel">
      <div className="table-scroll">
        <table className="data" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>Concept</th>
              <th>What it partitions</th>
              <th>What it isolates</th>
              <th>What stays coupled</th>
            </tr>
          </thead>
          <tbody>
            {SIBLING_ROWS.map(([name, partitions, isolates, coupled]) => (
              <tr key={name}>
                <td style={{ fontWeight: 600 }}>{name}</td>
                <td>{partitions}</td>
                <td>{isolates}</td>
                <td>{coupled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <p>
      Two distinctions carry most of the weight. First: zones and regions partition the{' '}
      <strong>provider's infrastructure</strong> — they contain fires and floods, not your bugs.
      A bad deploy replicates across all three AZs in seconds, exactly as designed. Cells
      partition <strong>your workload</strong>, so they contain the failures you actually cause.
      You want both; neither substitutes for the other.
    </p>
    <p>
      Second: microservices split by <strong>function</strong> — every user's request touches
      many services, so one sick service degrades everyone. Cells split by{' '}
      <strong>client</strong> — every cell runs every function for a few users. The two are
      orthogonal, and they compose: plenty of cell implementations run microservices{' '}
      <em>inside</em> each cell. The cell is what keeps a service's bad day from being
      everyone's bad day.
    </p>
  </section>
);

/* ------------------------------------------------------------------ */
/* 04 · The pattern family                                             */
/* ------------------------------------------------------------------ */

const PATTERNS: [string, string][] = [
  [
    'Bulkhead',
    'The ship-hull metaphor cells industrialize: compartments, so one flooding doesn’t sink the vessel. A cell is a bulkhead drawn around the entire stack, data included.',
  ],
  [
    'Circuit breaker',
    'Stop calling a failing dependency before it drags you down with it. Cells shrink what stands behind any one breaker — and make “stop calling it” a routing decision.',
  ],
  [
    'Load shedding',
    'Drop excess work on purpose instead of collapsing under it. A cell’s tested capacity ceiling tells you precisely when shedding must start, and confines it to one cell’s clients.',
  ],
  [
    'Graceful degradation',
    'Serve something rather than nothing. With cells, “degraded” is a property of one partition’s users — the rest aren’t degraded at all.',
  ],
  [
    'Sharding',
    'Partitioning the data tier. A cell is a shard that took the whole stack with it: compute, cache, queue, and blast radius included.',
  ],
  [
    'Consistent hashing',
    'How a router decides ownership without a giant lookup table — and without reshuffling everyone when a partition appears or dies. The deep dive is built around it.',
  ],
  [
    'Active-active',
    'Every copy takes real traffic all the time. Cells are active-active by construction — there is no standby copy quietly rotting until the day it’s finally needed.',
  ],
  [
    'Control plane vs data plane',
    'The machinery that changes the system vs the machinery that serves requests. Cell routing must live in the data plane and stay boring; the control plane can be down while every cell keeps serving.',
  ],
  [
    'Blast-radius reduction',
    'The umbrella goal all of the above serve. Cells are its bluntest, most legible instrument: one bad cell out of N is a 1/N incident, by arithmetic rather than by hope.',
  ],
];

const Patterns: React.FC = () => (
  <section className="lesson" id="patterns">
    <div className="kicker">04 · The pattern family</div>
    <h2>Where cells sit on the map</h2>
    <p>
      Cells don't replace the classic resilience patterns — they give most of them a boundary to
      operate inside. If you've met these before, here's how each one relates:
    </p>
    <div className="panel">
      <div className="table-scroll">
        <table className="data" style={{ minWidth: 560 }}>
          <tbody>
            {PATTERNS.map(([name, note]) => (
              <tr key={name}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{name}</td>
                <td>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    <div className="callout">
      <strong>Three more belong in this family</strong> — shuffle sharding, static stability,
      and constant work. They deserve pictures, not one-liners, and the deep dive has them:{' '}
      <a href="./index.html#beyond-cells">Beyond cells</a>.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 05 · Further reading                                                */
/* ------------------------------------------------------------------ */

interface ReadingItem {
  title: string;
  url: string;
  note: string;
}

const READING: { group: string; blurb: string; items: ReadingItem[] }[] = [
  {
    group: 'Microsoft',
    blurb: 'The most direct non-AWS treatment of the pattern, filed under its Azure name.',
    items: [
      {
        title: 'Deployment Stamps pattern',
        url: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp',
        note: 'The must-read: Microsoft’s equivalent of AWS cells, on one page.',
      },
      {
        title: 'Azure Well-Architected — Reliability',
        url: 'https://learn.microsoft.com/en-us/azure/well-architected/reliability/',
        note: 'Where stamps plug into the rest of Azure’s reliability guidance.',
      },
    ],
  },
  {
    group: 'Google',
    blurb:
      'Google publishes research papers and operations practice, not architecture guides — the cell thinking is in there, between the lines.',
    items: [
      {
        title: 'The SRE book (full table of contents)',
        url: 'https://sre.google/sre-book/table-of-contents/',
        note: 'Read “Handling Overload” and “Addressing Cascading Failures” — why partitions save you when load goes sideways.',
      },
      {
        title: 'Google SRE books',
        url: 'https://sre.google/books/',
        note: 'The rest of the shelf, including Building Secure and Reliable Systems.',
      },
      {
        title: 'Large-scale cluster management at Google with Borg',
        url: 'https://research.google/pubs/pub43438/',
        note: 'The original “cell”: Borg schedules machines into cells of about 10,000.',
      },
      {
        title: 'Spanner: Google’s globally distributed database',
        url: 'https://research.google/pubs/pub39966/',
        note: 'The counterpoint: what it costs to make one database span the world instead of partitioning it.',
      },
    ],
  },
  {
    group: 'AWS',
    blurb: 'Included for symmetry — this is the doc the deep dive on this site implements.',
    items: [
      {
        title: 'Reducing the Scope of Impact with Cell-Based Architecture',
        url: 'https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/reducing-scope-of-impact-with-cell-based-architecture.html',
        note: 'The most complete architecture guide on the pattern anyone has published.',
      },
    ],
  },
  {
    group: 'Practitioners',
    blurb: 'The pattern in production, written by the people carrying the pager.',
    items: [
      {
        title: 'Slack’s Migration to a Cellular Architecture',
        url: 'https://slack.engineering/slacks-migration-to-a-cellular-architecture/',
        note: 'The best public war story of retrofitting cells onto a live system.',
      },
      {
        title: 'Netflix Tech Blog',
        url: 'https://netflixtechblog.com/',
        note: 'Regional isolation and chaos engineering — evacuating a region as a routine drill.',
      },
      {
        title: 'Shopify Engineering',
        url: 'https://shopify.engineering/',
        note: 'Search “pods”: one merchant’s flash sale, contained to one pod.',
      },
      {
        title: 'Stripe Engineering Blog',
        url: 'https://stripe.com/blog/engineering',
        note: 'Sharding and isolation where the failure mode is someone’s money.',
      },
      {
        title: 'Martin Fowler — Architecture guide',
        url: 'https://martinfowler.com/architecture/',
        note: 'Vendor-neutral background on the ideas cells build on.',
      },
    ],
  },
];

const Reading: React.FC = () => (
  <section className="lesson" id="reading">
    <div className="kicker">05 · Further reading</div>
    <h2>The reading list</h2>
    <p>
      Everything above, from the people who wrote it down first. Grouped by dialect:
    </p>
    {READING.map(({ group, blurb, items }) => (
      <div className="panel reading-group" key={group}>
        <h3><Icon name="book-open" size={18} />{group}</h3>
        <p className="reading-blurb">{blurb}</p>
        <ul className="reading-list">
          {items.map(({ title, url, note }) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">{title}</a>
              <span> — {note}</span>
            </li>
          ))}
        </ul>
      </div>
    ))}
    <div className="callout">
      <strong>Then come back:</strong> the{' '}
      <a href="./index.html">interactive deep dive</a> turns this page's ideas into things you
      can push on — build the hash ring, route a client, kill a cell, and watch the blast
      radius obey the arithmetic.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */

const PrimerApp: React.FC = () => (
  <>
    <nav className="top-nav" aria-label="Sections">
      <span className="brand"><RingMark size={18} band={5} vnodes={4} /> Cells · Primer</span>
      <a href="#road">The road</a>
      <a href="#vocabulary">Vocabulary</a>
      <a href="#same-thing">Same thing?</a>
      <a href="#patterns">Patterns</a>
      <a href="#reading">Reading</a>
      <span style={{ flex: 1 }} />
      <a href="./index.html" style={{ fontWeight: 600 }}>Guide</a>
      <a href="./slides.html" style={{ fontWeight: 600 }}>Slides</a>
      {hasLiveDemo && (
        <a href={demoAdminUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
          Live demo ↗
        </a>
      )}
      <ThemeToggle />
    </nav>
    <header className="hero">
      <h1>Before cells: why big systems fail big</h1>
      <p className="lede">
        A cloud-neutral primer on the problem that cell-based architecture solves. No AWS
        account, no vendor accent — just the road from "one box" to "why is everyone down?",
        the vocabulary every cloud uses for the fix, and where to read more. When you're ready
        to push buttons, the <a href="./index.html">interactive deep dive</a> is next door.
      </p>
      <RingMark className="hero-ring" size={240} band={4} vnodes={36} />
    </header>
    <main>
      <TheRoad />
      <Vocabulary />
      <SameThing />
      <Patterns />
      <Reading />
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

export default PrimerApp;
