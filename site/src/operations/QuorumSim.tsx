import React, { useEffect, useRef, useState } from 'react';
import Icon from '../ui/icons';
import { EventLog, Lamp, SimEvent } from './shared';

/**
 * Sim 2 — The quorum switch.
 *
 * Five voters (items an operator creates or deletes), each observed by an
 * independent health checker; a calculated check counts the healthy voters
 * against a threshold. Two lamps tell the whole story:
 *
 *  - LIVE:   recomputed on every evaluator tick — it IS the quorum math.
 *  - STORED: written only when the LIVE decision CHANGES. When the control
 *    plane (the evaluator) dies, LIVE goes dark but STORED keeps serving
 *    the last committed decision — Route 53 ARC's static stability.
 *
 * Every transition lands in the event log; the Playwright suite recomputes
 * healthy >= threshold from the voter states and checks both lamps.
 */

const VOTERS = 5;
const TICK_MS = 500;

interface Voter {
  on: boolean; // the vote item exists
  broken: boolean; // the endpoint is broken: checkers observe 500 regardless
}

interface Stored {
  on: boolean;
  since: number; // sim ms when the decision was written
}

interface Sim {
  voters: Voter[];
  threshold: number;
  cpAlive: boolean;
  stored: Stored;
  events: SimEvent[];
}

/** What an outside health checker observes for voter i: an HTTP status. */
const observedCode = (v: Voter): 200 | 503 | 500 => (v.broken ? 500 : v.on ? 200 : 503);
const isHealthy = (v: Voter) => observedCode(v) === 200;
const healthyCount = (voters: Voter[]) => voters.filter(isHealthy).length;

const initialSim = (): Sim => ({
  voters: Array.from({ length: VOTERS }, () => ({ on: true, broken: false })),
  threshold: 3,
  cpAlive: true,
  stored: { on: true, since: 0 },
  events: [
    {
      t: 0,
      type: 'armed',
      healthy: VOTERS,
      threshold: 3,
      label: 'armed: 5 voters ON, threshold 3 — evaluator wrote the initial decision: Routing = Enabled',
      tone: 'info',
    },
  ],
});

const QuorumSim: React.FC = () => {
  const [sim, setSim] = useState<Sim>(initialSim);
  const startRef = useRef(performance.now());
  const now = () => Math.round(performance.now() - startRef.current);

  // The evaluator: each tick recomputes LIVE and, only on a transition,
  // writes STORED. Killing the control plane stops this loop's effect —
  // modelled as the tick doing nothing while cpAlive is false.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = now();
      setSim((s) => {
        if (!s.cpAlive) return s;
        const healthy = healthyCount(s.voters);
        const live = healthy >= s.threshold;
        if (live === s.stored.on) return s; // no transition — nothing written
        return {
          ...s,
          stored: { on: live, since: t },
          events: [
            ...s.events,
            {
              t,
              type: 'stored-flip',
              to: live,
              healthy,
              threshold: s.threshold,
              label: `evaluator saw ${healthy} of ${VOTERS} healthy ${live ? '>=' : '<'} threshold ${s.threshold} — STORED decision flipped to ${live ? 'Enabled' : 'Disabled'}`,
              tone: live ? 'good' : 'bad',
            },
          ],
        };
      });
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const toggleVote = (i: number) => {
    const t = now();
    setSim((s) => {
      if (!s.cpAlive) return s; // voting is a control-plane write
      const voters = s.voters.map((v, j) => (j === i ? { ...v, on: !v.on } : v));
      return {
        ...s,
        voters,
        events: [
          ...s.events,
          {
            t,
            type: 'vote',
            voter: i + 1,
            on: voters[i].on,
            healthy: healthyCount(voters),
            label: `operator ${voters[i].on ? 'created' : 'deleted'} vote item #${i + 1} — checkers will now observe ${observedCode(voters[i])}`,
            tone: 'info',
          },
        ],
      };
    });
  };

  const toggleBreak = (i: number) => {
    const t = now();
    setSim((s) => {
      const voters = s.voters.map((v, j) => (j === i ? { ...v, broken: !v.broken } : v));
      return {
        ...s,
        voters,
        events: [
          ...s.events,
          {
            t,
            type: 'break',
            voter: i + 1,
            broken: voters[i].broken,
            healthy: healthyCount(voters),
            label: voters[i].broken
              ? `voter #${i + 1} endpoint BROKE — checkers observe 500 regardless of its vote`
              : `voter #${i + 1} endpoint fixed — checkers observe ${observedCode(voters[i])} again`,
            tone: voters[i].broken ? 'bad' : 'good',
          },
        ],
      };
    });
  };

  const setThreshold = (n: number) => {
    const t = now();
    setSim((s) =>
      s.cpAlive
        ? {
            ...s,
            threshold: n,
            events: [
              ...s.events,
              { t, type: 'threshold', threshold: n, label: `threshold set to ${n} of ${VOTERS}`, tone: 'info' },
            ],
          }
        : s
    );
  };

  const toggleCp = () => {
    const t = now();
    setSim((s) => ({
      ...s,
      cpAlive: !s.cpAlive,
      events: [
        ...s.events,
        s.cpAlive
          ? {
              t,
              type: 'cp-killed',
              label: 'CONTROL PLANE KILLED — no more evaluation, no more votes. The data plane keeps serving the STORED decision.',
              tone: 'bad',
            }
          : { t, type: 'cp-restored', label: 'control plane restored — evaluation resumes on the next tick', tone: 'good' },
      ],
    }));
  };

  const healthy = healthyCount(sim.voters);
  const live = healthy >= sim.threshold;
  const pct = (v: number) => `${(v / VOTERS) * 100}%`;

  return (
    <div className="panel" data-testid="quorum-sim" data-healthy={healthy} data-threshold={sim.threshold} data-cp={sim.cpAlive ? 'alive' : 'dead'}>
      <div className="controls">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: '1 1 240px' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>threshold</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={sim.threshold}
            disabled={!sim.cpAlive}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ flex: 1 }}
            data-testid="quorum-threshold"
            aria-label="Healthy voters required for the switch to be on"
          />
          <span style={{ fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {sim.threshold} of {VOTERS}
          </span>
        </label>
        <span style={{ flex: 1 }} />
        {sim.cpAlive ? (
          <button className="danger" onClick={toggleCp} data-testid="quorum-kill-cp">
            <Icon name="bolt" />Kill the control plane
          </button>
        ) : (
          <button onClick={toggleCp} data-testid="quorum-kill-cp">Restore the control plane</button>
        )}
      </div>

      <div className={`ops-voter-row${sim.cpAlive ? '' : ' cp-dead'}`}>
        {sim.voters.map((v, i) => {
          const code = observedCode(v);
          return (
            <div key={i} className={`ops-voter${v.broken ? ' broken' : ''}`} data-testid="voter" data-index={i + 1} data-on={v.on} data-broken={v.broken} data-code={code}>
              <div className="ops-voter-name">voter {i + 1}</div>
              <button
                className={`ops-vote-switch${v.on ? ' on' : ''}`}
                role="switch"
                aria-checked={v.on}
                aria-label={`Voter ${i + 1} vote ${v.on ? 'on' : 'off'}`}
                disabled={!sim.cpAlive}
                onClick={() => toggleVote(i)}
                data-testid={`vote-${i + 1}`}
              >
                <span className="knob" />
                {v.on ? 'ON' : 'OFF'}
              </button>
              <div className={`ops-checker code-${code}`} title={`an independent health checker probes this voter and sees HTTP ${code}`}>
                <span className="ops-checker-dot" aria-hidden="true" />
                checker sees {code}
              </div>
              <button className="ops-break-btn" onClick={() => toggleBreak(i)} data-testid={`break-${i + 1}`}>
                {v.broken ? 'Fix it' : 'Break it'}
              </button>
            </div>
          );
        })}
      </div>
      {!sim.cpAlive && (
        <p className="ops-cp-note" data-testid="quorum-cp-note">
          the voting API is down — votes and threshold are frozen. Breaking an endpoint still works: the world can
          keep failing while nobody is evaluating.
        </p>
      )}

      <div className="meter-wrap">
        <div className="meter-label">
          <span>healthy voters: {healthy} of {VOTERS}</span>
          <span>threshold = {sim.threshold}</span>
        </div>
        <div className="meter" role="img" aria-label={`${healthy} of ${VOTERS} voters healthy, threshold ${sim.threshold}`}>
          <div className={healthy >= sim.threshold ? 'fill-ok' : 'fill-gap'} style={{ width: pct(healthy), left: 0 }} />
          <div className="demand-line" style={{ left: pct(sim.threshold) }} />
        </div>
      </div>

      <div className="ops-lamp-row">
        <Lamp
          label="LIVE — recomputed each tick"
          state={sim.cpAlive ? (live ? 'on' : 'off') : 'down'}
          detail={sim.cpAlive ? `${healthy} >= ${sim.threshold} is ${String(live)} → Routing = ${live ? 'Enabled' : 'Disabled'}` : undefined}
          testid="live-lamp"
        />
        <Lamp
          label="STORED — written only on transitions"
          state={sim.stored.on ? 'on' : 'off'}
          detail={`Routing = ${sim.stored.on ? 'Enabled' : 'Disabled'} · since t+${(sim.stored.since / 1000).toFixed(1)}s`}
          testid="stored-lamp"
          data={{ 'data-on': String(sim.stored.on) }}
        />
      </div>

      <EventLog events={sim.events} testid="quorum-event" />
      <p className="panel-hint">
        LIVE is the calculated check — <code>count(healthy) &gt;= threshold</code>, recomputed forever. STORED is
        the routing control the data plane reads, written only when the count <em>crosses</em> the threshold.
        That split is why killing the control plane strands nothing: the last decision keeps serving, unattended.
        Statically stable, in the{' '}
        <a href="https://aws.amazon.com/builders-library/static-stability-using-availability-zones/" target="_blank" rel="noopener noreferrer">
          Builders' Library sense
        </a>
        .
      </p>
    </div>
  );
};

export default QuorumSim;
