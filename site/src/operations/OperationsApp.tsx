import React from 'react';
import RingMark from '../ui/RingMark';
import ThemeToggle from '../ui/ThemeToggle';
import Icon from '../ui/icons';
import TryLive, { demoAdminUrl, hasLiveDemo } from '../TryLive';
import IdempotencySim from './IdempotencySim';
import QuorumSim from './QuorumSim';
import ConsensusLogSim from './ConsensusLogSim';
import { Notebook } from './shared';

/**
 * The Operations page: what it takes to OPERATE cells across regions once
 * they exist — retry safely (idempotency), decide health by vote (quorum),
 * commit decisions as versions (consensus vs convergence), and know where
 * those ideas came from (Paxos → Raft). Companion to the AWS demo's
 * failover/quorum/idempotency tabs; every panel runs entirely in the browser.
 */

/* ------------------------------------------------------------------ */
/* 01 · Idempotency                                                    */
/* ------------------------------------------------------------------ */

const Idempotency: React.FC = () => (
  <section className="lesson" id="idempotency">
    <div className="kicker">01 · Idempotency</div>
    <h2>Retry without double-charging</h2>
    <p data-testid="section-lede">
      A failover retry is the same command arriving twice — and the client can't know whether the
      first landed. The fix: hash the request and let the repeat find the first attempt's record.{' '}
      <strong>Same key, one effect</strong> — but only if both sides can <em>see</em> the record: a
      global table protects exactly as far as replication has reached.
    </p>
    <IdempotencySim />
    <div className="callout">
      <strong>In production you don't hand-roll this.</strong>{' '}
      <a href="https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/" target="_blank" rel="noopener noreferrer">
        AWS Lambda Powertools' idempotency utility
      </a>{' '}
      implements the whole record dance as a decorator over your handler, with DynamoDB as the
      store. The AWS demo wires it to a <em>global</em> table so one record protects both regions —
      and to isolated tables so you can watch the guarantee disappear.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 02 · Quorum                                                         */
/* ------------------------------------------------------------------ */

const Quorum: React.FC = () => (
  <section className="lesson" id="quorum">
    <div className="kicker">02 · Quorum</div>
    <h2>Five checkers outvote one liar</h2>
    <p data-testid="section-lede">
      Who decides a region is dead? One health check can lie, and demanding unanimity lets one
      broken checker veto every decision — so <strong>don't ask everyone, ask enough</strong>.
      Route&nbsp;53's calculated health checks count five independent observers against a
      threshold — <code>healthy &gt;= 3</code> — and act on the count.
    </p>
    <p>
      The two lamps carry the deeper lesson: <strong>LIVE</strong> is the recomputation;{' '}
      <strong>STORED</strong> is what the data plane reads, written only when the count crosses the
      threshold. Kill the control plane and the stored decision keeps serving:
    </p>
    <QuorumSim />
    <div className="callout">
      <strong>This is the mental model for Route&nbsp;53 Application Recovery Controller:</strong>{' '}
      routing controls are stored state in a five-region quorum data plane, and your DNS keeps
      obeying the last stored control even if the cluster that changes it is unreachable. This
      repository's demo builds the same shape from ordinary health checks, for about $0.12 an hour.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 03 · Consensus — versions, not retries                              */
/* ------------------------------------------------------------------ */

const Consensus: React.FC = () => (
  <section className="lesson" id="consensus">
    <div className="kicker">03 · Consensus</div>
    <h2>Versions, not retries</h2>
    <p data-testid="section-lede">
      A real control plane makes decision after decision, and five regions must agree on their{' '}
      <em>order</em>. The move every serious system makes: stop shouting commands ("enable
      routing!") and start committing <strong>versions</strong> ("v127 · Routing = Enabled") —
      numbered pages in a ledger, each unambiguous about what came before it.
    </p>
    <p>
      Five accountants, five offices, one ledger: an entry is booked once three of five have
      written it — the firm doesn't wait for anyone on vacation — and the returning accountant
      copies the pages she missed, in order, rather than asking the client to resubmit the trade.
      Press the switch:
    </p>
    <ConsensusLogSim />
    <p>
      The two panels under the sim are the whole lesson. <strong>Consensus</strong> — "can the
      system safely decide?" — is answered by a majority, <em>immediately</em>: v127 was law on its
      3rd ack, while Tokyo was still dark. <strong>Convergence</strong> — "does every region
      match?" — is answered by log replication, <em>afterward</em>. Blur the two and either
      stragglers can veto the world, or retried commands land twice — the bug idempotency just
      fixed.
    </p>
    <div className="callout">
      <strong>Same shape in the AWS demo:</strong> every genuine threshold crossing on the quorum
      tab appends a numbered <code>QUORUM_LOG</code> item, and the dashboard renders that log as
      exactly this notebook. The site lesson and the live demo are the same ledger.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 04 · Paxos → Raft in 60 seconds                                     */
/* ------------------------------------------------------------------ */

const PaxosRaft: React.FC = () => (
  <section className="lesson" id="paxos-raft">
    <div className="kicker">04 · Lineage</div>
    <h2>Paxos → Raft in 60 seconds</h2>
    <p>
      You just watched majority consensus work; Paxos is where it was <em>proved</em>. Leslie
      Lamport's{' '}
      <a href="https://lamport.azurewebsites.net/pubs/paxos-simple.pdf" target="_blank" rel="noopener noreferrer">
        "The Part-Time Parliament"
      </a>{' '}
      (written 1989, published 1998) showed that two phases — prepare/promise on a ballot number,
      then accept/accepted — commit a value no failure can lose, because any two majorities
      intersect. But it shipped as a puzzle: single-decree at its core, with everything production
      needs — a <em>log</em> of decisions (Multi-Paxos), stable leaders, membership changes — left
      as exercises. Every implementation reinvented those differently; Chubby's engineers famously
      reported the gap between the paper and a working system was enormous.
    </p>
    <p>
      <a href="https://raft.github.io/" target="_blank" rel="noopener noreferrer">Raft</a>{' '}
      (Ongaro &amp; Ousterhout, 2014 — "In Search of an Understandable Consensus Algorithm") keeps
      the same guarantees but designs for <em>understandability</em>: one strong leader per term,
      elected with randomized timeouts; replication as AppendEntries from that leader; and the
      safety rule that only a candidate with an up-to-date log can win an election. The log is not
      an exercise — it is the first-class object, exactly the ledger you watched five regions copy
      above.
    </p>
    <div className="ops-evo" data-testid="evo-timeline">
      <div className="ops-evo-card" data-testid="evo-paxos">
        <div className="ops-evo-era">1989 · published 1998</div>
        <div className="ops-evo-name">Paxos</div>
        <div className="ops-evo-cite">Lamport — "The Part-Time Parliament"</div>
        <ul className="ops-evo-list">
          <li><strong>roles</strong><span>proposers · acceptors · learners</span></li>
          <li><strong>protocol</strong><span>two-phase ballots: prepare/promise → accept/accepted</span></li>
          <li><strong>decides</strong><span>one value per instance (single-decree)</span></li>
        </ul>
        <div className="ops-evo-diy">log · leaders · membership: build it yourself</div>
      </div>
      <div className="ops-evo-arrow" aria-hidden="true">→</div>
      <div className="ops-evo-card" data-testid="evo-raft">
        <div className="ops-evo-era">2014</div>
        <div className="ops-evo-name">Raft</div>
        <div className="ops-evo-cite">Ongaro &amp; Ousterhout — "In Search of an Understandable Consensus Algorithm"</div>
        <ul className="ops-evo-list">
          <li><strong>roles</strong><span>one leader per term · randomized election timeouts</span></li>
          <li><strong>protocol</strong><span>AppendEntries — the leader replicates the log</span></li>
          <li><strong>safety</strong><span>only an up-to-date log can win election</span></li>
        </ul>
        <div className="ops-evo-log">
          <Notebook
            compact
            title="the log — built in"
            entries={[
              { version: 127, decision: 'Enabled' },
              { version: 128, decision: 'Disabled' },
              { version: 129, decision: 'Enabled' },
            ]}
          />
        </div>
      </div>
    </div>
    <div className="ops-evo-today" data-testid="evo-today">
      <span className="ops-evo-today-label">today</span>
      <span className="ops-evo-adopter"><strong>Route&nbsp;53 ARC</strong> — Paxos family</span>
      <span className="ops-evo-adopter"><strong>etcd</strong> · <strong>Consul</strong> · <strong>CockroachDB</strong> · <strong>TiKV</strong> — Raft</span>
    </div>
    <p>
      The punchline: both are "a majority writes the next page into an ordered notebook." ARC's
      five-region cluster speaks a Paxos-family protocol; etcd, Consul, CockroachDB, and TiKV speak
      Raft. You have already watched both do it.
    </p>
  </section>
);

/* ------------------------------------------------------------------ */
/* 05 · Keep reading                                                   */
/* ------------------------------------------------------------------ */

const Reading: React.FC = () => (
  <section className="lesson" id="reading">
    <div className="kicker">05 · Keep reading</div>
    <h2>The sources, and the real thing</h2>
    <p>
      Every panel above is a browser-sized model of machinery you can read about — and, with the
      AWS demo deployed, actually operate:
    </p>
    <div className="panel reading-group">
      <h3><Icon name="book-open" size={18} />Where these ideas come from</h3>
      <ul className="reading-list">
        <li>
          <a href="https://docs.aws.amazon.com/r53recovery/latest/dg/what-is-route53-recovery.html" target="_blank" rel="noopener noreferrer">
            Route 53 Application Recovery Controller
          </a>
          <span> — routing controls in a five-region quorum data plane; the production version of sims 2 and 3.</span>
        </li>
        <li>
          <a href="https://aws.amazon.com/builders-library/static-stability-using-availability-zones/" target="_blank" rel="noopener noreferrer">
            Static stability using Availability Zones
          </a>
          <span> — why the STORED lamp must keep serving when the control plane dies.</span>
        </li>
        <li>
          <a href="https://aws.amazon.com/builders-library/reliability-and-constant-work/" target="_blank" rel="noopener noreferrer">
            Reliability, constant work, and a good cup of coffee
          </a>
          <span> — the checkers that feed the quorum push a full table on every tick, storm or calm.</span>
        </li>
        <li>
          <a href="https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/" target="_blank" rel="noopener noreferrer">
            AWS Lambda Powertools — Idempotency
          </a>
          <span> — the production implementation of sim 1's record table.</span>
        </li>
      </ul>
    </div>
    <TryLive path="">Operate the real thing: the failover and quorum demos in the live admin dashboard</TryLive>
    <div className="callout">
      <strong>And the rest of this site:</strong> the{' '}
      <a href="./index.html">interactive deep dive</a> builds the hash ring these regions route
      with; <a href="./index.html#beyond-cells">Beyond cells</a> gives static stability and
      constant work the full treatment.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */

const OperationsApp: React.FC = () => (
  <>
    <nav className="top-nav" aria-label="Sections">
      <span className="brand"><RingMark size={18} band={5} vnodes={4} /> Cells · Operations</span>
      <a href="#idempotency">Idempotency</a>
      <a href="#quorum">Quorum</a>
      <a href="#consensus">Versions</a>
      <a href="#paxos-raft">Paxos → Raft</a>
      <a href="#reading">Reading</a>
      <span style={{ flex: 1 }} />
      <a href="./index.html" style={{ fontWeight: 600 }}>Guide</a>
      <a href="./primer.html" style={{ fontWeight: 600 }}>Primer</a>
      <a href="./slides.html" style={{ fontWeight: 600 }}>Slides</a>
      {hasLiveDemo && (
        <a href={demoAdminUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
          Live demo ↗
        </a>
      )}
      <ThemeToggle />
    </nav>
    <header className="hero">
      <h1>Operating cells: retries, quorums, and versioned truth</h1>
      <p className="lede">
        Building cells is chapter one; failover is chapter two — and failover means retries and
        splits. That leaves exactly two ways to be wrong: the same command lands twice
        (idempotency's problem), or replicas disagree about what was decided (consensus's problem).
        Each section below builds on the previous one's answer, and every sim computes its outcome
        for real, in your browser.
      </p>
      <RingMark className="hero-ring" size={240} band={4} vnodes={36} />
    </header>
    <main>
      <Idempotency />
      <Quorum />
      <Consensus />
      <PaxosRaft />
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

export default OperationsApp;
