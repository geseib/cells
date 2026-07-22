import React from 'react';
import RingMark from '../ui/RingMark';
import ThemeToggle from '../ui/ThemeToggle';
import Icon from '../ui/icons';
import TryLive, { demoAdminUrl, hasLiveDemo } from '../TryLive';
import IdempotencySim from './IdempotencySim';
import QuorumSim from './QuorumSim';
import ConsensusLogSim from './ConsensusLogSim';

/**
 * The Operations page: what it takes to OPERATE cells across regions once
 * they exist — retry safely (idempotency), decide health by vote (quorum),
 * and commit decisions as versions instead of re-firing commands (consensus
 * vs convergence). Companion to the AWS demo's failover/quorum/idempotency
 * tabs; every panel here runs entirely in the browser.
 */

/* ------------------------------------------------------------------ */
/* 01 · Idempotency                                                    */
/* ------------------------------------------------------------------ */

const Idempotency: React.FC = () => (
  <section className="lesson" id="idempotency">
    <div className="kicker">01 · Idempotency</div>
    <h2>Retry without double-charging</h2>
    <p>
      Failover has an ugly secret: the retry. A client pays in Virginia, Virginia dies before the
      response arrives, and the client does the only reasonable thing — sends the same payment to
      Oregon. Was the first one charged? The client cannot know. The <em>system</em> has to make
      the answer not matter, and the tool for that is an <strong>idempotency record</strong>: hash
      the request, write an <code>INPROGRESS</code> lock before doing the work, store the response
      when done, and answer every repeat of the same hash from the stored response instead of
      doing the work again.
    </p>
    <p>
      The catch is <em>where that record lives</em>. Keep it in a per-region table and the record
      dies with the region — the guarantee was never cross-region at all. Put it in a replicated
      global table and the guarantee is exactly as good as the replication is fast: there is an
      honest window, one replication lag wide, where a retry lands before the record does. Run
      both below. The double-charge counter is not scripted — it counts rows in the charges
      table, and the only way to make it move is to genuinely beat the replication:
    </p>
    <IdempotencySim />
    <div className="callout">
      <strong>In production you don't hand-roll this.</strong>{' '}
      <a href="https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/" target="_blank" rel="noopener noreferrer">
        AWS Lambda Powertools' idempotency utility
      </a>{' '}
      implements the whole dance — payload hashing, the <code>INPROGRESS</code> lock, response
      capture, expiry — as a decorator over your handler, with DynamoDB as the store. The AWS demo
      in this repository wires it to a DynamoDB <em>global</em> table so the same record protects
      both regions, and to isolated tables so you can watch the guarantee disappear.
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
    <p>
      Failover's second hard question: <em>who decides a region is dead?</em> One health check is
      one opinion — and one broken observer, one severed network path, one confused checker can
      flip your whole system on a lie. The fix is as old as committees: don't ask one observer,
      ask five, and act on the <strong>count</strong>. Route&nbsp;53 does exactly this with
      calculated health checks: five child checks, each independently observed from many vantage
      points, aggregated by a rule — <code>healthy children &gt;= threshold</code>.
    </p>
    <p>
      The subtler half of the design is the two lamps. The <strong>LIVE</strong> lamp is the
      recomputation — it exists only while the evaluator runs. The <strong>STORED</strong> lamp is
      the decision the data plane actually reads, written only when the count <em>crosses</em> the
      threshold. Kill the control plane below and watch the difference: voting freezes, evaluation
      stops, and the stored decision keeps serving — the failure of the decision-maker does not
      undo the decision. Break voters while nobody is watching, then restore the control plane and
      watch it catch up:
    </p>
    <QuorumSim />
    <div className="callout">
      <strong>This is the mental model for Route&nbsp;53 Application Recovery Controller:</strong>{' '}
      routing controls are stored state in a dedicated, five-region data plane, changed by quorum,
      and your DNS keeps obeying the last stored control even if the cluster that changes it is
      unreachable. The demo in this repository builds the same shape out of ordinary health checks
      — a calculated parent over five voter endpoints — for about $0.12 an hour instead of
      ARC's cluster pricing.
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
    <p>
      Now the deepest one. The quorum switch above stores <em>a</em> decision — but a real control
      plane makes decision after decision, and five regions must agree on <em>the order</em> of
      all of them. The trick every serious system lands on: stop thinking in commands
      ("enable routing!") and start thinking in <strong>versions</strong> ("v127 · Routing =
      Enabled"). A command is an event that either happened or didn't — ambiguous the moment a
      packet drops. A version is a <em>page in a ledger</em>: numbered, ordered, copyable, and
      utterly unambiguous about what came before it.
    </p>
    <p>
      Think of five accountants in five offices keeping the same ledger. A new entry is booked
      when three of the five have written it into their books — the firm doesn't wait for anyone
      on vacation. When the fifth accountant comes back, she doesn't ask the client to resubmit
      the trade; she asks a colleague "what page are you on?", copies the pages she missed, in
      order, and her book ends up identical. Press the switch:
    </p>
    <ConsensusLogSim />
    <p>
      The two-panel distinction at the bottom of the sim is the whole lesson.{' '}
      <strong>Consensus</strong> asks "can the system safely decide?" — it's answered by a
      majority and it's answered <em>immediately</em>; v127 was law while Tokyo was still dark.{' '}
      <strong>Convergence</strong> asks "does every region eventually match?" — it's answered by
      log replication, <em>afterward</em>, at whatever pace the stragglers reconnect. Systems get
      in trouble when they blur the two: waiting for all five before deciding (now two slow
      regions can veto the world), or retrying commands instead of replicating history (now a
      re-pressed button can land twice, out of order — the exact bug idempotency had to fix
      above). Versioned logs make both mistakes structurally impossible.
    </p>
    <div className="callout">
      <strong>Same shape, real systems:</strong> this is Raft and Paxos in one picture — and it's
      how the AWS demo's quorum tab stores its decisions: every genuine threshold crossing appends
      a numbered <code>QUORUM_LOG</code> item ("v127 · Enabled") to the decision log, and the
      dashboard renders that log as exactly the notebook you see above. The site lesson and the
      live demo are the same ledger.
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/* 04 · Keep reading                                                   */
/* ------------------------------------------------------------------ */

const Reading: React.FC = () => (
  <section className="lesson" id="reading">
    <div className="kicker">04 · Keep reading</div>
    <h2>The sources, and the real thing</h2>
    <p>
      Everything on this page is a browser-sized model of machinery you can read about — and, with
      the AWS demo in this repository deployed, actually operate:
    </p>
    <div className="panel reading-group">
      <h3><Icon name="book-open" size={18} />Where these ideas come from</h3>
      <ul className="reading-list">
        <li>
          <a href="https://docs.aws.amazon.com/r53recovery/latest/dg/what-is-route53-recovery.html" target="_blank" rel="noopener noreferrer">
            Route 53 Application Recovery Controller
          </a>
          <span> — routing controls as stored state in a five-region quorum data plane; the production version of sims 2 and 3.</span>
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
      with, and the <a href="./index.html#beyond-cells">Beyond cells</a> section gives static
      stability and constant work the full interactive treatment.
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
        Building cells is chapter one. Chapter two is operating them when a region dies with a
        payment half-finished, a health check starts lying, and five copies of the control plane
        have to agree on what happens next. Three simulations, all running in your browser, all
        computing their outcomes for real — companions to this repository's{' '}
        <a href="./index.html">interactive guide</a> and its deployable AWS demo.
      </p>
      <RingMark className="hero-ring" size={240} band={4} vnodes={36} />
    </header>
    <main>
      <Idempotency />
      <Quorum />
      <Consensus />
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
