import React from 'react';
import Sidequest from '../ui/Sidequest';
import AlgoZoo from './AlgoZoo';

/**
 * "Choosing your hash" — the algorithm zoo. Adapts a survey of consistent-
 * hashing algorithms (classic ring, rendezvous/HRW, jump, maglev, multi-probe,
 * CRUSH) into the site's teaching flow: six interactive mini-demo cards driven
 * by one shared membership event (AlgoZoo), the comparison score card, the
 * add-one-server scaling table (whose mod-N row is the same cliff the
 * kill-a-cell demo measures live), recommendations, and what this repo
 * actually runs.
 */

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
    <div className="kicker">07 · The algorithm zoo</div>
    <h2>Choosing your hash</h2>
    <p className="lede">
      "Consistent hashing" names a goal, not one algorithm — there is a whole menu: the classic
      ring with virtual nodes, rendezvous, jump, maglev, multi-probe, CRUSH. Each trades balance,
      lookup cost, memory, and weight support a little differently.
    </p>
    <p>
      The shopping list is always the same — say 10&nbsp;million users across 100 servers: an even
      spread (≈100,000 users each), minimal movement when a server joins or leaves, fast lookup,
      low memory, and stable placement. Several algorithms hit that goal, and none wins on
      everything. Each card below is a live mini-demo, and all six answer the same event from one
      shared control row:
    </p>
    <AlgoZoo />

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
  </section>
);

export default HashChoices;
