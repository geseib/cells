import React from 'react';
import RingMark from '../ui/RingMark';
import Sidequest from '../ui/Sidequest';

/**
 * "Choosing your hash" — the algorithm zoo. Adapts a survey of consistent-
 * hashing algorithms (classic ring, rendezvous/HRW, jump, maglev, multi-probe,
 * CRUSH) into the site's teaching flow: six cards with honest pros/cons, the
 * comparison score card, the add-one-server scaling table (whose mod-N row is
 * the same cliff the kill-a-cell demo measures live), recommendations, and
 * what this repo actually runs.
 */

/* ---- tiny header glyphs, one per algorithm, in the site's SVG language ---- */

const G = 20; // glyph box

/** Rendezvous: per-node score bars — the tallest one wins. */
const ScoreBarsGlyph: React.FC = () => (
  <svg width={G} height={G} viewBox="0 0 20 20" aria-hidden="true">
    <rect x={1} y={12} width={3} height={7} rx={1} fill="var(--baseline)" />
    <rect x={6} y={8} width={3} height={11} rx={1} fill="var(--baseline)" />
    <rect x={11} y={2} width={3} height={17} rx={1} fill="var(--good)" />
    <rect x={16} y={10} width={3} height={9} rx={1} fill="var(--baseline)" />
  </svg>
);

/** Maglev: a strip of lookup-table slots mapping straight to servers. */
const LookupStripGlyph: React.FC = () => (
  <svg width={G} height={G} viewBox="0 0 20 20" aria-hidden="true">
    {['var(--cell-1)', 'var(--cell-2)', 'var(--cell-3)', 'var(--cell-1)', 'var(--cell-4)', 'var(--cell-2)'].map(
      (c, i) => (
        <rect key={i} x={0.5 + i * 3.25} y={7} width={2.7} height={6} rx={0.8} fill={c} />
      )
    )}
  </svg>
);

/** Multi-probe: a small plain ring, probed at a few points. */
const ProbeRingGlyph: React.FC = () => (
  <svg width={G} height={G} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={7.5} fill="none" stroke="var(--baseline)" strokeWidth={2} />
    <circle cx={10} cy={2.5} r={2} fill="var(--cell-1)" />
    <circle cx={16.5} cy={13.75} r={2} fill="var(--cell-2)" />
    <circle cx={3.5} cy={13.75} r={2} fill="var(--cell-3)" />
  </svg>
);

/** CRUSH: a topology tree — region, zones, hosts. */
const TreeGlyph: React.FC = () => (
  <svg width={G} height={G} viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 4v4M10 8 5 12M10 8l5 4" stroke="var(--baseline)" strokeWidth={1.5} fill="none" />
    <circle cx={10} cy={3} r={2.2} fill="var(--cell-4)" />
    <circle cx={5} cy={13} r={2} fill="var(--cell-1)" />
    <circle cx={15} cy={13} r={2} fill="var(--cell-2)" />
    <circle cx={5} cy={18} r={1.4} fill="var(--baseline)" />
    <circle cx={15} cy={18} r={1.4} fill="var(--baseline)" />
    <path d="M5 15v1.5M15 15v1.5" stroke="var(--baseline)" strokeWidth={1.5} />
  </svg>
);

/* ---- the six algorithms ---- */

type Algo = {
  name: string;
  glyph?: React.ReactNode;
  how: React.ReactNode;
  pros: string[];
  cons: string[];
};

const ALGOS: Algo[] = [
  {
    name: 'Classic hash ring',
    glyph: <RingMark size={G} band={5} vnodes={8} />,
    how: (
      <>
        Hash servers onto a circle; hash each key and walk clockwise to the next server. The one
        from <a href="#hash-ring">02 · The hash ring</a>.
      </>
    ),
    pros: [
      '~1/N of keys move when a server joins or leaves',
      'weights fall out of virtual-node counts',
      'widely implemented and understood',
    ],
    cons: [
      'poor balance without virtual nodes',
      'the ring lives in memory and must be maintained',
      'virtual nodes buy balance with memory and bookkeeping',
    ],
  },
  {
    name: 'Rendezvous (HRW)',
    glyph: <ScoreBarsGlyph />,
    how: (
      <>
        For every key, score every server — <code>score(server, key)</code> — and the highest
        score wins. No ring at all.
      </>
    ),
    pros: [
      'excellent balance with no virtual nodes',
      'very simple to implement',
      'only keys that prefer the new server move',
      'weighted variants are natural',
    ],
    cons: [
      'O(N) per lookup — every server gets scored',
      'gets expensive at thousands of nodes',
    ],
  },
  {
    name: 'Jump consistent hash',
    glyph: <span className="hash-chip algo-chip">ƒ(key, N)</span>,
    how: (
      <>
        A pure function from <code>(key, bucket count)</code> to a bucket number. No ring, no
        table, no state.
      </>
    ),
    pros: [
      'O(1) lookup, zero memory',
      'excellent distribution, minimal key movement',
      'extremely fast — a few multiplies',
    ],
    cons: [
      'buckets must be numbered 0..N−1, so you can only shrink from the end',
      'no weighted nodes in the basic algorithm',
    ],
  },
  {
    name: 'Maglev',
    glyph: <LookupStripGlyph />,
    how: (
      <>
        Precompute a large lookup table mapping hash values straight to servers — Google's
        load-balancer design.
      </>
    ),
    pros: [
      'O(1) lookup with excellent cache locality',
      'excellent distribution',
      'minimal remapping on change',
    ],
    cons: [
      'the table must be rebuilt whenever membership changes',
      'the table costs real memory',
    ],
  },
  {
    name: 'Multi-probe',
    glyph: <ProbeRingGlyph />,
    how: (
      <>
        A small ring with no virtual nodes: probe each key several times and take the closest
        hit — probes buy the balance vnodes would.
      </>
    ),
    pros: [
      'good balance',
      'far less memory than virtual-node rings',
      'minimal remapping',
    ],
    cons: [
      'more complex to implement',
      'each lookup pays for k probes — slightly slower',
    ],
  },
  {
    name: 'CRUSH',
    glyph: <TreeGlyph />,
    how: (
      <>
        Walks a topology tree — region → zone → rack → host → disk — choosing a placement at
        each level. Ceph's placement engine.
      </>
    ),
    pros: [
      'fault-aware placement across failure domains',
      'flexible replication policies',
      'scales to very large storage clusters',
    ],
    cons: [
      'much more complex than anything else here',
      'overkill unless you are building a storage system',
    ],
  },
];

/* ---- comparison + scaling data ---- */

const COMPARISON: [string, string, string, string, string, string, string][] = [
  ['Classic ring', 'Good (excellent with vnodes)', 'Excellent', 'O(log N)', 'Medium', 'Yes', 'General caches'],
  ['Rendezvous', 'Excellent', 'Excellent', 'O(N)', 'Tiny', 'Yes', 'Small/medium clusters'],
  ['Jump', 'Excellent', 'Excellent', 'O(1)', 'None', 'No (basic)', 'Large homogeneous clusters'],
  ['Maglev', 'Excellent', 'Excellent', 'O(1)', 'Large', 'Limited', 'High-speed load balancers'],
  ['Multi-probe', 'Very good', 'Excellent', 'O(k log N)', 'Small', 'Yes', 'Memory-efficient rings'],
  ['CRUSH', 'Excellent', 'Excellent', 'O(log hierarchy)', 'Small', 'Yes', 'Distributed storage'],
];

const SCALING: [string, string][] = [
  ['Classic ring', '~1%'],
  ['Rendezvous', '~1%'],
  ['Jump', '~1%'],
  ['Maglev', '~1%'],
  ['Multi-probe', '~1%'],
];

const RECOMMENDATIONS: [string, string][] = [
  ['Distributed cache', 'Rendezvous or multi-probe — excellent balance, minimal remapping, simple to implement.'],
  ['Massive stateless routing', 'Jump — O(1), zero memory, extremely fast; fine as long as nodes are interchangeable.'],
  ['High-performance load balancer', 'Maglev — constant-time lookups built for very high packet rates.'],
  ['Distributed storage', 'CRUSH — rack/zone awareness and intelligent replica placement.'],
  ['Heterogeneous fleet', 'Weighted rendezvous or a ring with virtual nodes — both let big servers own more keyspace.'],
];

const HashChoices: React.FC = () => (
  <section className="lesson" id="hash-choices">
    <div className="kicker">06 · The algorithm zoo</div>
    <h2>Choosing your hash</h2>
    <Sidequest
      id="hash-choices-zoo"
      className="sidequest-lg"
      kicker="Optional deep-dive · six algorithms compared"
      title="The consistent-hashing menu"
      blurb={
        <>
          <p>
            "Consistent hashing" names a goal, not one algorithm — there is a whole menu: the
            classic ring with virtual nodes, rendezvous, jump, maglev, multi-probe, CRUSH. Each
            trades balance, lookup cost, memory, and weight support a little differently.
          </p>
          <p>
            For this discussion — and for the demo behind every visualization on this page — we
            use the <strong>classic hash ring with virtual nodes</strong>: remapping stays minimal
            (a cell hands over exactly its share of the keyspace, nothing more), it is simple to
            implement and reason about, weights fall out of virtual-node counts, and the exact
            recipe reproduces identically in every language — which is what keeps this page honest
            with the deployed backend.
          </p>
          <span className="sidequest-expand-hint">
            Expand for the full algorithm-by-algorithm comparison
          </span>
        </>
      }
    >
    <p>
      The shopping list is always the same — say 10&nbsp;million users across 100 servers: an even
      spread (≈100,000 users each), minimal movement when a server joins or leaves, fast lookup,
      low memory, and stable placement. Several algorithms hit that goal, and none of them wins on
      everything — each trades balance, lookup speed, memory, and weight support differently.
    </p>
    <div className="algo-grid">
      {ALGOS.map((a) => (
        <div key={a.name} className="panel algo-card">
          <h3>
            {a.glyph && <span className="algo-glyph">{a.glyph}</span>}
            {a.name}
          </h3>
          <p className="algo-how">{a.how}</p>
          <ul className="algo-pros">
            {a.pros.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <ul className="algo-cons">
            {a.cons.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>

    <h3 className="hc-subhead">The score card</h3>
    <p className="hc-subtext">
      Every row minimizes key movement — that's the entry fee. The real differences are balance
      quality, lookup cost, memory, and whether weighted nodes are possible:
    </p>
    <div className="panel">
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Algorithm</th>
              <th>Balance</th>
              <th>Key movement</th>
              <th>Lookup</th>
              <th>Memory</th>
              <th>Weighted nodes</th>
              <th>Best for</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    <h3 className="hc-subhead">Add one server to a hundred</h3>
    <p className="hc-subtext">
      The table that justifies the whole family. Grow a 100-server cluster to 101 and every
      consistent-hashing algorithm moves about 1 key in 100 — while naive <code>hash&nbsp;%&nbsp;N</code>{' '}
      reshuffles nearly everyone:
    </p>
    <div className="panel">
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Algorithm</th>
              <th>Keys that move</th>
            </tr>
          </thead>
          <tbody>
            {SCALING.map(([name, moved]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="lc-good">{moved}</td>
              </tr>
            ))}
            <tr>
              <td>
                Modulo (<code>hash&nbsp;%&nbsp;N</code>)
              </td>
              <td className="lc-bad">~99% ❌</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="panel-hint">
        That last row is the same cliff you already watched in{' '}
        <a href="#kill-a-cell">04 · Kill a cell</a> — its "would have moved under naive
        hash&nbsp;mod&nbsp;N" stat is this table measured live, just in the shrinking direction.
      </p>
    </div>

    <h3 className="hc-subhead">Which one, then?</h3>
    <div className="panel">
      <dl className="reco-dl">
        {RECOMMENDATIONS.map(([need, pick]) => (
          <React.Fragment key={need}>
            <dt>{need}</dt>
            <dd>{pick}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>

    <div className="callout">
      <strong>What this repo runs, and why:</strong> a ketama-style MD5 ring with 150 virtual
      nodes per unit of weight. Not the fastest row in the score card — chosen because the recipe
      is trivially reproducible in any language (the same few lines run in the Node backend, this
      browser page, and a bash smoke test), weights fall out naturally, and any cell can join or
      leave. One golden value — <span className="hash-chip">md5("user123") → 1,792,101,289</span>{' '}
      — is asserted across all four codebases to prove they agree. Which is the honest takeaway
      of the whole zoo: the decision that matters is less <em>which</em> algorithm than running{' '}
      <em>exactly one recipe everywhere</em>, guarded so it can never drift.
    </div>
    </Sidequest>
  </section>
);

export default HashChoices;
