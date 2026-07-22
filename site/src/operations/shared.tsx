import React, { useEffect, useState } from 'react';

/**
 * Shared bits for the Operations page sims. Kept local to the operations
 * entry so the page stays self-contained (same convention as the primer's
 * local RingMark copy).
 */

/** True when the user asked the OS for reduced motion — gates sim pacing. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** A committed decision, as one line of a region's ledger. */
export interface DecisionEntry {
  version: number;
  decision: 'Enabled' | 'Disabled';
}

export const decisionLine = (e: DecisionEntry) => `v${e.version} · Routing = ${e.decision}`;

/**
 * The decision log rendered as a paper notebook: ruled lines, a red margin,
 * one committed decision per line. This is the canonical copy of the visual —
 * the admin dashboard's quorum tab echoes the same rendering for the REAL
 * decision log (frontend/admin is a separate npm package, so it carries a
 * port, like icons.tsx does).
 */
export const Notebook: React.FC<{
  title: string;
  entries: DecisionEntry[];
  /** Versions to draw with the "freshly copied in" flash. */
  fresh?: ReadonlySet<number>;
  compact?: boolean;
  testid?: string;
}> = ({ title, entries, fresh, compact, testid }) => (
  <div className={`notebook${compact ? ' compact' : ''}`} data-testid={testid}>
    <div className="nb-title">{title}</div>
    <div className="nb-pages">
      {entries.length === 0 && <div className="nb-line nb-empty">— empty —</div>}
      {entries.map((e) => (
        <div
          key={e.version}
          className={`nb-line${fresh?.has(e.version) ? ' fresh' : ''}`}
          data-testid="nb-entry"
          data-version={e.version}
          data-decision={e.decision}
        >
          <span className="nb-version">v{e.version}</span>
          <span className="nb-decision">Routing = {e.decision}</span>
        </div>
      ))}
    </div>
  </div>
);

/** Indicator lamp: green ON / red OFF / grey unknown, with a label line. */
export const Lamp: React.FC<{
  label: string;
  state: 'on' | 'off' | 'down';
  detail?: string;
  testid?: string;
  data?: Record<string, string>;
}> = ({ label, state, detail, testid, data }) => (
  <div className={`ops-lamp ${state}`} data-testid={testid} data-state={state} {...data}>
    <span className="bulb" aria-hidden="true" />
    <span className="lamp-text">
      <span className="lamp-label">{label}</span>
      <span className="lamp-detail">
        {state === 'down' ? 'unavailable' : detail ?? (state === 'on' ? 'ON' : 'OFF')}
      </span>
    </span>
  </div>
);

/** One sim event, rendered into the assertable under-the-covers log. */
export interface SimEvent {
  /** Milliseconds since the sim started (sim clock). */
  t: number;
  type: string;
  label: string;
  tone?: 'good' | 'bad' | 'info' | 'warn';
  /** Extra machine-readable fields for the Playwright suite. */
  [key: string]: unknown;
}

/**
 * The under-the-covers event log. Every state transition in a sim appends
 * here; the Playwright suite parses the data-event JSON and recomputes the
 * sim's math independently. Nothing in the UI is scripted past this log.
 */
export const EventLog: React.FC<{ events: SimEvent[]; testid: string; title?: string }> = ({
  events,
  testid,
  title,
}) => (
  <div className="ops-eventlog-wrap">
    <div className="mini-title">{title ?? 'Under the covers — the sim’s event log'}</div>
    <div className="ops-eventlog" role="log" aria-label={title ?? 'Simulation event log'}>
      {events.length === 0 && <div className="ops-event muted">— no events yet —</div>}
      {events.map((e, i) => {
        const { label, tone, ...data } = e;
        return (
          <div
            key={i}
            className={`ops-event ${tone ?? 'info'}`}
            data-testid={testid}
            data-event={JSON.stringify(data)}
          >
            <span className="ev-t">{(e.t / 1000).toFixed(2)}s</span>
            <span className="ev-label">{label}</span>
          </div>
        );
      })}
    </div>
  </div>
);
