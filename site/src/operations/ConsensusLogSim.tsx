import React, { useEffect, useRef, useState } from 'react';
import Icon from '../ui/icons';
import { DecisionEntry, EventLog, Lamp, Notebook, SimEvent, usePrefersReducedMotion } from './shared';

/**
 * Sim 3 — Versions, not retries.
 *
 * Five regions each keep an ordered log of committed decisions. Pressing the
 * switch PROPOSES the next version to all five; the decision commits the
 * instant a majority (3) has stored it — the stragglers are nobody's
 * problem. A region that was offline never asks anyone to re-press the
 * button: it reconnects, asks "what's your newest version?", and copies the
 * missing pages of history, in order, until its ledger matches.
 *
 * Every transition is an entry in the sim's event log — the commit fires
 * inside the same state transition as the 3rd ack, catch-up replays are one
 * event per version — so the Playwright suite can recompute everything.
 */

type RegionId = 'virginia' | 'ohio' | 'oregon' | 'dublin' | 'tokyo';
type Status = 'online' | 'network' | 'offline';
type Decision = 'Enabled' | 'Disabled';
type Outcome = 'pending' | 'ack' | 'lost' | 'unreachable';

const REGIONS: { id: RegionId; name: string; code: string }[] = [
  { id: 'virginia', name: 'Virginia', code: 'us-east-1' },
  { id: 'ohio', name: 'Ohio', code: 'us-east-2' },
  { id: 'oregon', name: 'Oregon', code: 'us-west-2' },
  { id: 'dublin', name: 'Dublin', code: 'eu-west-1' },
  { id: 'tokyo', name: 'Tokyo', code: 'ap-northeast-1' },
];

const MAJORITY = 3; // floor(5/2) + 1

// Pacing (ms, scaled to 10% under prefers-reduced-motion — order is what
// matters, and order is preserved).
const ACK_BASE = 450;
const ACK_STEP = 400;
const MISS_BASE = 2200; // lost/unreachable verdicts land AFTER the commit
const MISS_STEP = 250;
const BUBBLE_STEP = 500;
const REPLAY_STEP = 450;

const SEED: DecisionEntry[] = [
  { version: 124, decision: 'Disabled' },
  { version: 125, decision: 'Enabled' },
  { version: 126, decision: 'Disabled' },
];

interface Proposal {
  version: number;
  decision: Decision;
  outcomes: Record<RegionId, Outcome>;
  ackCount: number;
  committed: boolean;
  /** Regions that had NOT stored it when the majority landed. */
  laggardsAtCommit: RegionId[];
  done: boolean;
}

interface Catchup {
  region: RegionId;
  peer: RegionId;
  phase: 'connecting' | 'ask' | 'tell' | 'have' | 'replaying';
  from: number; // local tip at reconnect
  target: number; // committed tip at reconnect
}

interface Sim {
  status: Record<RegionId, Status>;
  logs: Record<RegionId, DecisionEntry[]>;
  history: DecisionEntry[]; // the canonical committed history
  committed: DecisionEntry;
  nextVersion: number;
  proposal: Proposal | null;
  catchup: Catchup | null;
  fresh: Record<RegionId, number[]>; // versions to flash as freshly copied
  converged: boolean;
  events: SimEvent[];
}

const logsEqual = (a: DecisionEntry[], b: DecisionEntry[]) =>
  a.length === b.length && a.every((e, i) => e.version === b[i].version && e.decision === b[i].decision);

const initialSim = (): Sim => ({
  status: { virginia: 'online', ohio: 'online', oregon: 'online', dublin: 'network', tokyo: 'offline' },
  logs: Object.fromEntries(REGIONS.map((r) => [r.id, [...SEED]])) as Record<RegionId, DecisionEntry[]>,
  history: [...SEED],
  committed: SEED[SEED.length - 1],
  nextVersion: 127,
  proposal: null,
  catchup: null,
  fresh: { virginia: [], ohio: [], oregon: [], dublin: [], tokyo: [] },
  converged: true,
  events: [],
});

const regionName = (id: RegionId) => REGIONS.find((r) => r.id === id)!.name;

/** Recompute the convergence flag; emits the transition event when it flips true. */
function withConvergence(s: Sim, t: number): Sim {
  const settled = (!s.proposal || s.proposal.done) && !s.catchup;
  const allMatch = REGIONS.every((r) => logsEqual(s.logs[r.id], s.history));
  const conv = settled && allMatch;
  if (conv === s.converged) return s;
  if (!conv) return { ...s, converged: false };
  return {
    ...s,
    converged: true,
    events: [
      ...s.events,
      { t, type: 'converged', label: 'CONVERGED — all five ledgers are now identical', tone: 'good' },
    ],
  };
}

const ConsensusLogSim: React.FC = () => {
  const [sim, setSim] = useState<Sim>(initialSim);
  const simRef = useRef(sim);
  useEffect(() => {
    simRef.current = sim;
  });
  const reduced = usePrefersReducedMotion();
  const scale = reduced ? 0.1 : 1;
  const startRef = useRef(performance.now());
  const timersRef = useRef<number[]>([]);
  // Synchronous re-entrancy locks: simRef trails a render, so a rapid double
  // click could otherwise schedule a second identical fan-out.
  const lockRef = useRef({ proposing: false, catchingUp: false });
  const now = () => Math.round(performance.now() - startRef.current);
  const schedule = (delay: number, fn: () => void) => {
    timersRef.current.push(window.setTimeout(fn, Math.max(10, delay * scale)));
  };
  useEffect(() => () => timersRef.current.forEach((id) => window.clearTimeout(id)), []);

  const reset = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
    lockRef.current = { proposing: false, catchingUp: false };
    startRef.current = performance.now();
    setSim(initialSim());
  };

  // ---- proposal fan-out ---------------------------------------------------

  const ackArrives = (region: RegionId, version: number) => {
    const t = now();
    setSim((s) => {
      if (!s.proposal || s.proposal.version !== version || s.proposal.outcomes[region] !== 'pending') return s;
      const entry: DecisionEntry = { version, decision: s.proposal.decision };
      const ackCount = s.proposal.ackCount + 1;
      const outcomes = { ...s.proposal.outcomes, [region]: 'ack' as Outcome };
      const logs = { ...s.logs, [region]: [...s.logs[region], entry] };
      let events: SimEvent[] = [
        ...s.events,
        {
          t,
          type: 'ack',
          region,
          version,
          ackCount,
          label: `${regionName(region)} stored v${version} — ack ${ackCount} of ${MAJORITY} needed`,
          tone: 'good',
        },
      ];
      let next: Sim = { ...s, logs, proposal: { ...s.proposal, outcomes, ackCount } };
      // THE moment: the majority's third copy lands — commit fires inside
      // this very state transition, without waiting for anyone else.
      if (ackCount === MAJORITY && !s.proposal.committed) {
        const laggards = REGIONS.filter((r) => outcomes[r.id] !== 'ack').map((r) => r.id);
        events = [
          ...events,
          {
            t,
            type: 'commit',
            version,
            ackCount,
            onAck: region,
            laggards,
            label: `MAJORITY ACHIEVED on ${regionName(region)}'s ack — v${version} COMMITTED (3 of 5). Not waiting for ${laggards.map(regionName).join(' or ') || 'anyone'}.`,
            tone: 'good',
          },
        ];
        next = {
          ...next,
          proposal: { ...next.proposal!, committed: true, laggardsAtCommit: laggards },
          committed: entry,
          history: [...s.history, entry],
        };
      }
      return withConvergence({ ...next, events }, t);
    });
  };

  const missArrives = (region: RegionId, version: number, kind: 'lost' | 'unreachable') => {
    const t = now();
    setSim((s) => {
      if (!s.proposal || s.proposal.version !== version || s.proposal.outcomes[region] !== 'pending') return s;
      return {
        ...s,
        proposal: { ...s.proposal, outcomes: { ...s.proposal.outcomes, [region]: kind } },
        events: [
          ...s.events,
          {
            t,
            type: kind,
            region,
            version,
            label:
              kind === 'lost'
                ? `${regionName(region)}: network problem — the v${version} write never arrived`
                : `${regionName(region)} is offline — unreachable for v${version}`,
            tone: 'bad',
          },
        ],
      };
    });
  };

  const settleProposal = (version: number) => {
    const t = now();
    setSim((s) => {
      if (!s.proposal || s.proposal.version !== version || s.proposal.done) return s;
      let next: Sim = { ...s, proposal: { ...s.proposal, done: true } };
      let events = next.events;
      if (!s.proposal.committed) {
        // No majority: the proposal is abandoned — the few stored copies are
        // withdrawn. (Real systems supersede rather than erase; the lesson —
        // no majority, no decision — is the same.)
        const acked = REGIONS.filter((r) => s.proposal!.outcomes[r.id] === 'ack').map((r) => r.id);
        const logs = { ...next.logs };
        acked.forEach((r) => {
          logs[r] = logs[r].filter((e) => e.version !== version);
        });
        events = [
          ...events,
          {
            t,
            type: 'no-quorum',
            version,
            ackCount: s.proposal.ackCount,
            label: `only ${s.proposal.ackCount} of 5 stored v${version} — NO MAJORITY, nothing was decided`,
            tone: 'bad',
          },
        ];
        next = { ...next, logs };
      } else {
        events = [
          ...events,
          { t, type: 'settled', version, label: `v${version} fan-out settled — every region has a verdict`, tone: 'info' },
        ];
      }
      return withConvergence({ ...next, events }, t);
    });
  };

  const propose = () => {
    const s = simRef.current;
    if ((s.proposal && !s.proposal.done) || s.catchup) return;
    if (lockRef.current.proposing || lockRef.current.catchingUp) return;
    lockRef.current.proposing = true;
    const t = now();
    const version = s.nextVersion;
    const decision: Decision = s.committed.decision === 'Enabled' ? 'Disabled' : 'Enabled';
    const statuses = { ...s.status }; // outcomes are decided by the world as it is NOW
    setSim((prev) => ({
      ...prev,
      nextVersion: version + 1,
      converged: false,
      proposal: {
        version,
        decision,
        outcomes: Object.fromEntries(REGIONS.map((r) => [r.id, 'pending'])) as Record<RegionId, Outcome>,
        ackCount: 0,
        committed: false,
        laggardsAtCommit: [],
        done: false,
      },
      events: [
        ...prev.events,
        {
          t,
          type: 'propose',
          version,
          decision,
          label: `operator pressed the switch — PROPOSAL v${version} · Routing = ${decision} fans out to all five regions`,
          tone: 'info',
        },
      ],
    }));
    let latest = 0;
    REGIONS.forEach((r, idx) => {
      const st = statuses[r.id];
      const at = st === 'online' ? ACK_BASE + idx * ACK_STEP : MISS_BASE + idx * MISS_STEP;
      latest = Math.max(latest, at);
      if (st === 'online') schedule(at, () => ackArrives(r.id, version));
      else schedule(at, () => missArrives(r.id, version, st === 'network' ? 'lost' : 'unreachable'));
    });
    schedule(latest + 150, () => {
      lockRef.current.proposing = false;
      settleProposal(version);
    });
  };

  // ---- reconnect & catch-up ----------------------------------------------

  const replayArrives = (region: RegionId, version: number, last: boolean) => {
    const t = now();
    setSim((s) => {
      const entry = s.history.find((e) => e.version === version);
      if (!entry || !s.catchup || s.catchup.region !== region) return s;
      const logs = { ...s.logs, [region]: [...s.logs[region], entry] };
      const fresh = { ...s.fresh, [region]: [...s.fresh[region], version] };
      let events: SimEvent[] = [
        ...s.events,
        {
          t,
          type: 'replay',
          region,
          version,
          label: `page v${version} copied into ${regionName(region)}'s ledger`,
          tone: 'good',
        },
      ];
      let next: Sim = { ...s, logs, fresh, events };
      if (last) {
        events = [
          ...events,
          {
            t,
            type: 'caught-up',
            region,
            tip: version,
            label: `${regionName(region)} is caught up at v${version} — nobody re-pressed anything`,
            tone: 'good',
          },
        ];
        next = { ...next, events, catchup: null };
      }
      return withConvergence(next, t);
    });
  };

  const startCatchup = (region: RegionId) => {
    const s = simRef.current;
    lockRef.current.catchingUp = true;
    const local = s.logs[region][s.logs[region].length - 1]?.version ?? 0;
    const target = s.committed.version;
    const peer = REGIONS.find(
      (r) => r.id !== region && s.status[r.id] === 'online' && logsEqual(s.logs[r.id], s.history)
    )?.id ?? 'virginia';
    const t = now();
    setSim((prev) => ({
      ...prev,
      catchup: { region, peer, phase: 'connecting', from: local, target },
      events: [
        ...prev.events,
        { t, type: 'reconnect', region, localTip: local, committedTip: target, label: `${regionName(region)} is back online — local ledger ends at v${local}, the world is at v${target}`, tone: 'info' },
      ],
    }));
    const phase = (p: Catchup['phase'], delay: number, ev: SimEvent) =>
      schedule(delay, () => {
        const tt = now();
        setSim((prev) =>
          prev.catchup && prev.catchup.region === region
            ? { ...prev, catchup: { ...prev.catchup, phase: p }, events: [...prev.events, { ...ev, t: tt }] }
            : prev
        );
      });
    phase('ask', BUBBLE_STEP, {
      t: 0, type: 'ask', region, peer,
      label: `${regionName(region)} asks ${regionName(peer)}: “What's your newest version?”`, tone: 'info',
    });
    phase('tell', BUBBLE_STEP * 2, {
      t: 0, type: 'tell', region, peer, latest: target,
      label: `${regionName(peer)} answers: “v${target}.”`, tone: 'info',
    });
    phase('have', BUBBLE_STEP * 3, {
      t: 0, type: 'have', region, local,
      label: `${regionName(region)}: “I only have v${local}.”`, tone: 'info',
    });
    phase('replaying', BUBBLE_STEP * 4, {
      t: 0, type: 'replay-start', region, from: local + 1, to: target,
      label: `history replication begins — copying v${local + 1}…v${target}, in order`, tone: 'info',
    });
    const missing: number[] = [];
    for (let v = local + 1; v <= target; v++) missing.push(v);
    missing.forEach((v, i) =>
      schedule(BUBBLE_STEP * 4 + (i + 1) * REPLAY_STEP, () => {
        const isLast = i === missing.length - 1;
        if (isLast) lockRef.current.catchingUp = false;
        replayArrives(region, v, isLast);
      })
    );
    if (missing.length === 0) {
      schedule(BUBBLE_STEP * 4 + 100, () => {
        lockRef.current.catchingUp = false;
        const tt = now();
        setSim((prev) =>
          prev.catchup && prev.catchup.region === region ? withConvergence({ ...prev, catchup: null }, tt) : prev
        );
      });
    }
  };

  const setStatus = (region: RegionId, to: Status) => {
    const s = simRef.current;
    if ((s.proposal && !s.proposal.done) || s.catchup) return;
    if (lockRef.current.proposing || lockRef.current.catchingUp) return;
    if (s.status[region] === to) return;
    const wasDisconnected = s.status[region] !== 'online';
    const t = now();
    setSim((prev) => ({
      ...prev,
      status: { ...prev.status, [region]: to },
      events: [
        ...prev.events,
        {
          t,
          type: 'status-change',
          region,
          to,
          label: `${regionName(region)} set to ${to === 'online' ? 'online' : to === 'network' ? 'network problem' : 'offline'}`,
          tone: to === 'online' ? 'good' : 'warn',
        },
      ],
    }));
    const behind = (s.logs[region][s.logs[region].length - 1]?.version ?? 0) < s.committed.version;
    if (to === 'online' && wasDisconnected && behind) startCatchup(region);
  };

  // ---- render -------------------------------------------------------------

  const busy = (sim.proposal !== null && !sim.proposal.done) || sim.catchup !== null;
  const nextDecision: Decision = sim.committed.decision === 'Enabled' ? 'Disabled' : 'Enabled';
  const p = sim.proposal;

  const outcomeBadge = (r: RegionId) => {
    if (!p || p.done) return null;
    const o = p.outcomes[r];
    if (o === 'ack') return <span className="ops-outcome ack" data-testid={`outcome-${r}`} data-outcome="ack"><Icon name="check" size={12} strokeWidth={2.4} /> stored v{p.version}</span>;
    if (o === 'lost') return <span className="ops-outcome lost" data-testid={`outcome-${r}`} data-outcome="lost"><Icon name="x" size={12} /> lost in transit</span>;
    if (o === 'unreachable') return <span className="ops-outcome lost" data-testid={`outcome-${r}`} data-outcome="unreachable"><Icon name="x" size={12} /> unreachable</span>;
    return <span className="ops-outcome pending" data-testid={`outcome-${r}`} data-outcome="pending">v{p.version} in flight…</span>;
  };

  const statusSeg = (r: RegionId) => (
    <div className="ops-status-seg" role="group" aria-label={`${regionName(r)} connectivity`}>
      {(['online', 'network', 'offline'] as Status[]).map((st) => (
        <button
          key={st}
          className={sim.status[r] === st ? 'selected' : ''}
          disabled={busy}
          onClick={() => setStatus(r, st)}
          data-testid={`set-${st}-${r}`}
          title={st === 'network' ? 'reachable but drops this write' : st}
        >
          {st === 'online' ? 'online' : st === 'network' ? 'net trouble' : 'offline'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="panel" data-testid="consensus-sim" data-busy={busy}>
      <div className="controls">
        <button className="primary" onClick={propose} disabled={busy} data-testid="ops3-propose">
          <Icon name="bolt" />
          {busy
            ? sim.catchup
              ? 'replicating history…'
              : 'proposal in flight…'
            : `${nextDecision === 'Enabled' ? 'Enable' : 'Disable'} routing — propose v${sim.nextVersion}`}
        </button>
        <span className="ops-tolerance" data-testid="tolerance-math">
          5 replicas → majority = 3 → tolerates 2 unavailable
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={reset} data-testid="ops3-reset"><Icon name="refresh" />Reset</button>
      </div>

      {p && p.committed && (
        <div className="ops-banner commit" data-testid="commit-banner" data-version={p.version} data-ack-count={MAJORITY}>
          <Icon name="check-circle" size={18} strokeWidth={2} />
          <span>
            <strong>Majority achieved — decision COMMITTED.</strong> v{p.version} · Routing = {p.decision} became
            law the instant the 3rd copy landed{p.laggardsAtCommit.length > 0 && (
              <> — without waiting for {p.laggardsAtCommit.map(regionName).join(' or ')}</>
            )}.
          </span>
        </div>
      )}
      {p && p.done && !p.committed && (
        <div className="ops-banner no-quorum" data-testid="no-quorum-banner" data-version={p.version} data-ack-count={p.ackCount}>
          <Icon name="x-circle" size={18} strokeWidth={2} />
          <span>
            <strong>No majority — nothing was decided.</strong> Only {p.ackCount} of 5 stored v{p.version}; with 3
            or more regions unavailable the system refuses to decide rather than risk two truths.
          </span>
        </div>
      )}

      <div className="ops-consensus-grid">
        {REGIONS.map((r) => {
          const log = sim.logs[r.id];
          const tip = log[log.length - 1]?.version ?? 0;
          const behind = tip < sim.committed.version;
          return (
            <div
              key={r.id}
              className={`ops-cregion ${sim.status[r.id]}`}
              data-testid="region-card"
              data-region={r.id}
              data-status={sim.status[r.id]}
              data-tip={tip}
            >
              <div className="ops-region-head">
                <span className="ops-region-name">{r.name}</span>
                <span className="ops-region-code">{r.code}</span>
              </div>
              {statusSeg(r.id)}
              <div className="ops-cregion-badges">
                {outcomeBadge(r.id)}
                {behind && !(p && !p.done) && (
                  <span className="ops-outcome behind" data-testid={`behind-${r.id}`}>
                    behind — has v{tip}, world is at v{sim.committed.version}
                  </span>
                )}
              </div>
              <Notebook
                title={`${r.name} ledger`}
                entries={log}
                fresh={new Set(sim.fresh[r.id])}
                testid={`notebook-${r.id}`}
              />
            </div>
          );
        })}
      </div>

      {sim.catchup && (
        <div className="ops-catchup" data-testid="catchup-strip" data-region={sim.catchup.region} data-phase={sim.catchup.phase}>
          <div className="mini-title">Catch-up — history is replicated, requests are never retried</div>
          <div className="ops-bubbles">
            {['ask', 'tell', 'have', 'replaying'].indexOf(sim.catchup.phase) >= 0 && (
              <div className="ops-bubble from-region" data-testid="bubble-ask">
                <span className="who">{regionName(sim.catchup.region)}</span>
                “What's your newest version?”
              </div>
            )}
            {['tell', 'have', 'replaying'].indexOf(sim.catchup.phase) >= 0 && (
              <div className="ops-bubble from-peer" data-testid="bubble-tell">
                <span className="who">{regionName(sim.catchup.peer)}</span>
                “v{sim.catchup.target}.”
              </div>
            )}
            {['have', 'replaying'].indexOf(sim.catchup.phase) >= 0 && (
              <div className="ops-bubble from-region" data-testid="bubble-have">
                <span className="who">{regionName(sim.catchup.region)}</span>
                “I only have v{sim.catchup.from}.”
              </div>
            )}
            {sim.catchup.phase === 'replaying' && (
              <div className="ops-bubble copying" data-testid="bubble-copying">
                copying pages v{sim.catchup.from + 1}…v{sim.catchup.target} →
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ops-lamp-row">
        <Lamp
          label="COMMITTED STATE — what the routers obey"
          state={sim.committed.decision === 'Enabled' ? 'on' : 'off'}
          detail={`v${sim.committed.version} · Routing = ${sim.committed.decision}`}
          testid="committed-lamp"
          data={{ 'data-version': String(sim.committed.version), 'data-decision': sim.committed.decision }}
        />
      </div>

      <div className="ops-two-panel">
        <div className="ops-half consensus">
          <h4>CONSENSUS</h4>
          <p className="ops-half-q">“Can the system safely decide?”</p>
          <p>
            Answered by <strong>majority</strong>, and answered <strong>immediately</strong>: v{sim.committed.version} was
            law the moment its 3rd copy hit a disk. Two accountants out sick doesn't stop the firm from booking a
            trade — three signatures on the page make it real.
          </p>
        </div>
        <div className="ops-half convergence" data-testid="convergence" data-converged={sim.converged}>
          <h4>CONVERGENCE</h4>
          <p className="ops-half-q">“Does every region eventually match?”</p>
          <p>
            Answered by <strong>log replication</strong>, and answered <strong>afterward</strong>: the two absent
            accountants copy the missed pages into their own ledgers, in order, until all five books read the same.
          </p>
          <div className="ops-mini-books">
            {REGIONS.map((r) => (
              <Notebook key={r.id} title={r.name} entries={sim.logs[r.id]} compact testid={`mini-notebook-${r.id}`} />
            ))}
          </div>
          <div className={`ops-converged-badge${sim.converged ? ' yes' : ''}`}>
            {sim.converged ? (
              <><Icon name="check-circle" size={14} strokeWidth={2.2} /> converged — five identical ledgers</>
            ) : (
              <><Icon name="clock" size={14} strokeWidth={2} /> not yet converged — the ledgers differ</>
            )}
          </div>
        </div>
      </div>

      <EventLog events={sim.events} testid="ops3-event" />
      <p className="panel-hint">
        Try the full story: propose v{sim.nextVersion} (watch the commit land on the 3rd ack), keep Tokyo offline
        and flip the switch a few more times, then set Tokyo back online and watch it replay the exact missing
        versions in order. The button is never pressed twice; no request is ever retried —{' '}
        <strong>commands are ephemeral, versions are forever</strong>.
      </p>
    </div>
  );
};

export default ConsensusLogSim;
