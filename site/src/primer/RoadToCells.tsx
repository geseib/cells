import React, { useState } from 'react';
import { CELL_COLOR_VARS, FAILED_COLOR, cellColor, hashKey } from '../sim/simulation';
import Icon from '../ui/icons';

/**
 * "The road to cells" — one SVG, five steps, driven by a Prev/Next stepper.
 * The 24 client dots stay put across every step; only the architecture under
 * them changes. That continuity is the argument: the clients never asked for
 * any of this, they just want to be served.
 *
 * Step 5 fails cell B on purpose — the punchline needs a body.
 */

const W = 560;
const H = 268;
const CLIENTS = 24;
const DOT_Y = 24;
const DOT_R = 6;
const dotX = (i: number) => 46 + (i * 468) / (CLIENTS - 1);

const GROUPS = 4;
const PER_GROUP = CLIENTS / GROUPS;
const FAILED_GROUP = 1; // cell B dies in step 5
const groupOf = (i: number) => Math.floor(i / PER_GROUP);

interface Step {
  pill: string;
  title: string;
  caption: React.ReactNode;
  domains: number;
  blast: string;
  blastLabel: string;
}

const STEPS: Step[] = [
  {
    pill: '1 · Monolith',
    title: 'Day one: one application, one database, one box.',
    caption:
      'Everything lives together, so everything fails together. A bug, a full disk, a bad ' +
      'deploy — the whole customer base is standing in the same room as the problem. ' +
      'One failure domain, population: everyone.',
    domains: 1,
    blast: '100%',
    blastLabel: 'of clients affected when it breaks',
  },
  {
    pill: '2 · Scale up',
    title: 'Traffic grows. The box gets bigger.',
    caption:
      'This genuinely works — for a while. But there is always a bigger day, and there is a ' +
      'biggest machine. Vertical scale has a hard ceiling, and you paid all that money ' +
      'without buying a second failure domain.',
    domains: 1,
    blast: '100%',
    blastLabel: 'of clients affected when it breaks',
  },
  {
    pill: '3 · Scale out',
    title: 'N identical servers behind a load balancer.',
    caption:
      'Throughput: solved. Any server can serve any client, and you can add servers forever. ' +
      'But every server runs the same code against the same database — a bad deploy, a poison ' +
      'request, or a hot key still reaches everyone. The fleet grew; the fate stayed shared.',
    domains: 1,
    blast: '100%',
    blastLabel: 'of clients in the shared failure domain',
  },
  {
    pill: '4 · Blast radius',
    title: 'The shared tier has a bad day.',
    caption:
      'Watch the top row: every client flickers, because every client’s requests cross the ' +
      'same database. N servers bought you throughput and survival of a server — not survival ' +
      'of a mistake. Redundancy multiplies the boxes, not the failure domains. Redundancy ≠ isolation.',
    domains: 1,
    blast: '100%',
    blastLabel: 'of clients inside the blast radius',
  },
  {
    pill: '5 · Cells',
    title: 'Partition everything. Pin each client to one partition.',
    caption:
      'Four complete stacks — router aside, they share nothing, data included. Cell B just ' +
      'died, and 6 of 24 clients noticed. The other 18 aren’t lucky; they’re unreachable ' +
      'by the failure. Each partition is a failure domain, and a unit of scale: need more ' +
      'capacity, add a cell. This is a cell-based architecture.',
    domains: 4,
    blast: '25%',
    blastLabel: 'of clients inside the blast radius',
  },
];

/** Neutral outlined box with a centered label — the pre-cells visual dialect. */
const Box: React.FC<{
  x: number; y: number; w: number; h: number;
  label: string; sub?: string; dead?: boolean; dim?: boolean;
}> = ({ x, y, w, h, label, sub, dead, dim }) => (
  <g opacity={dim ? 0.5 : 1}>
    <rect x={x} y={y} width={w} height={h} rx={6}
      fill={dead ? FAILED_COLOR : 'var(--surface-1)'}
      stroke={dead ? FAILED_COLOR : 'var(--baseline)'} strokeWidth={1.5} />
    <text x={x + w / 2 + (dead ? 7 : 0)} y={y + h / 2 + (sub ? -2 : 4)} textAnchor="middle"
      fontSize={11} fontWeight={600} fill={dead ? '#fff' : 'var(--ink)'}>{label}</text>
    {sub && (
      <text x={x + w / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize={9.5}
        fill={dead ? '#fff' : 'var(--muted)'}>{sub}</text>
    )}
    {dead && (
      <path d={`M ${x + 9} ${y + h / 2 - 4} l 8 8 M ${x + 17} ${y + h / 2 - 4} l -8 8`}
        stroke="#fff" strokeWidth={1.75} strokeLinecap="round" />
    )}
  </g>
);

/** Thin curve from a client dot down into an entry point — the traffic funnel. */
const funnel = (i: number, tx: number, ty: number, stroke: string, opacity = 1) => {
  const x = dotX(i);
  return (
    <path key={`f-${i}`} fill="none" stroke={stroke} strokeWidth={1.1} opacity={opacity}
      d={`M ${x} ${DOT_Y + 8} C ${x} ${ty - 26}, ${tx} ${ty - 24}, ${tx} ${ty}`} />
  );
};

const RoadToCells: React.FC = () => {
  const [step, setStep] = useState(0);
  const s = STEPS[step];

  const dots = Array.from({ length: CLIENTS }, (_, i) => {
    const flickers = step === 3 || (step === 4 && groupOf(i) === FAILED_GROUP);
    const fill =
      flickers ? FAILED_COLOR : step === 4 ? CELL_COLOR_VARS[groupOf(i)] : 'var(--baseline)';
    return (
      <circle
        key={i}
        className={`client${flickers ? ' flicker' : ''}`}
        cx={dotX(i)}
        cy={DOT_Y}
        r={DOT_R}
        fill={fill}
        style={
          flickers
            ? {
                animationDelay: `-${hashKey(`road-${i}`) % 2000}ms`,
                animationDuration: `${1400 + (hashKey(`road-dur-${i}`) % 1600)}ms`,
              }
            : undefined
        }
      />
    );
  });

  const scene: React.ReactNode[] = [];

  if (step === 0 || step === 1) {
    const big = step === 1;
    const bx = big ? 170 : 205;
    const bw = big ? 220 : 150;
    const by = big ? 104 : 122;
    const bh = big ? 130 : 112;
    for (let i = 0; i < CLIENTS; i++) scene.push(funnel(i, W / 2, by - 2, 'var(--grid)'));
    scene.push(
      <Box key="mono" x={bx} y={by} w={bw} h={bh}
        label={big ? 'Everything, but larger' : 'Everything'} sub="app + data, one machine" />
    );
    if (big) {
      // the ceiling: vertical scale ends at the biggest machine money can buy
      scene.push(
        <g key="ceiling">
          <path d={`M 120 90 H 440`} stroke={FAILED_COLOR} strokeWidth={1.5} strokeDasharray="6 5" />
          <text x={448} y={86} fontSize={9.5} fill={FAILED_COLOR}>max instance</text>
          <text x={448} y={97} fontSize={9.5} fill={FAILED_COLOR}>size</text>
          <path d="M 143 156 V 100 M 138.5 107 143 99.5 147.5 107" fill="none"
            stroke="var(--ink-2)" strokeWidth={1.5} strokeLinecap="round" />
        </g>
      );
    }
  } else if (step === 2 || step === 3) {
    const dbDead = step === 3;
    const lbY = 74;
    const srvY = 138;
    const dbY = 212;
    const centers = [110, 223, 337, 450];
    for (let i = 0; i < CLIENTS; i++) scene.push(funnel(i, W / 2, lbY - 2, 'var(--grid)'));
    // LB → servers, servers → the one database
    centers.forEach((cx, k) => {
      const fromX = 175 + k * 70; // spread along the LB's underside
      scene.push(
        <path key={`ls-${k}`} fill="none" stroke="var(--grid)" strokeWidth={1.4}
          d={`M ${fromX} ${lbY + 24} C ${fromX} ${srvY - 20}, ${cx} ${srvY - 24}, ${cx} ${srvY - 2}`} />
      );
      const dbX = 235 + k * 30; // spread along the database's top edge
      const path = `M ${cx} ${srvY + 34} C ${cx} ${dbY - 22}, ${dbX} ${dbY - 26}, ${dbX} ${dbY - 2}`;
      scene.push(
        <path key={`sd-${k}`} fill="none" stroke="var(--grid)" strokeWidth={1.4} d={path} />
      );
      if (dbDead) {
        scene.push(
          <path key={`sdx-${k}`} fill="none" stroke={FAILED_COLOR} strokeWidth={2}
            strokeDasharray="5 4" className="flow-flicker"
            style={{ animationDelay: `-${hashKey(`road-db-${k}`) % 2400}ms` }} d={path} />
        );
      }
    });
    scene.push(<Box key="lb" x={150} y={lbY} w={260} h={24} label="Load balancer" />);
    centers.forEach((cx, k) =>
      scene.push(<Box key={`srv-${k}`} x={cx - 38} y={srvY} w={76} h={34} label={`Server ${k + 1}`} />)
    );
    scene.push(
      <Box key="db" x={195} y={dbY} w={170} h={36} label="Shared database"
        sub={dbDead ? undefined : 'one copy of the truth'} dead={dbDead} />
    );
  } else {
    // step 4: cells
    const routerY = 62;
    const centers = [110, 223, 337, 450];
    const CELL_W = 104;
    const cellTop = 106;
    const cellH = 128;
    for (let i = 0; i < CLIENTS; i++) {
      const g = groupOf(i);
      scene.push(funnel(i, centers[g], routerY - 2, CELL_COLOR_VARS[g], 0.75));
    }
    centers.forEach((cx, g) => {
      const dead = g === FAILED_GROUP;
      const color = dead ? FAILED_COLOR : cellColor(`cell-${'ABCD'[g]}`);
      const drop = `M ${cx} ${routerY + 22} V ${cellTop - 2}`;
      scene.push(
        <path key={`rc-${g}`} d={drop} fill="none"
          stroke={dead ? FAILED_COLOR : CELL_COLOR_VARS[g]} strokeWidth={2.4}
          strokeDasharray={dead ? '5 4' : undefined}
          className={dead ? 'flow-flicker' : undefined} />
      );
      scene.push(
        <g key={`cell-${g}`}>
          <rect x={cx - CELL_W / 2} y={cellTop} width={CELL_W} height={cellH} rx={8}
            fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 4" />
          {[0, 1].map((row) => {
            const y = cellTop + 14 + row * 44;
            return (
              <g key={row} opacity={dead ? 0.9 : 1}>
                <rect x={cx - 36} y={y} width={72} height={30} rx={5} fill={color} />
                <text x={cx} y={y + 19} textAnchor="middle" fontSize={10}
                  fontWeight={600} fill="#fff" textDecoration={dead ? 'line-through' : undefined}>
                  {row === 0 ? 'own stack' : 'own data'}
                </text>
              </g>
            );
          })}
          <text x={cx} y={cellTop + cellH - 10} textAnchor="middle" fontSize={11}
            fontWeight={dead ? 700 : 600} fill={dead ? FAILED_COLOR : 'var(--ink-2)'}>
            Cell {'ABCD'[g]}{dead ? ' — down' : ''}
          </text>
        </g>
      );
    });
    scene.push(<Box key="router" x={60} y={routerY} w={440} h={22} label="Request router" />);
  }

  return (
    <div className="panel road" role="group" aria-label="The road to cells, a five-step visual story">
      <div className="controls">
        <button onClick={() => setStep((v) => Math.max(0, v - 1))} disabled={step === 0}>
          ← Prev
        </button>
        <div className="stepper-pills">
          {STEPS.map((st, i) => (
            <button
              key={st.pill}
              className={`step-pill${i === step ? ' active' : ''}`}
              aria-pressed={i === step}
              onClick={() => setStep(i)}
            >
              {st.pill}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button
          className={step < STEPS.length - 1 ? 'primary' : ''}
          onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}
          disabled={step === STEPS.length - 1}
        >
          Next →
        </button>
      </div>
      <svg
        className="road-svg"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Step ${step + 1} of ${STEPS.length}: ${s.title}`}
      >
        <text x={dotX(0) - 8} y={DOT_Y - 12} fontSize={9.5} fill="var(--muted)">
          the same {CLIENTS} clients, every step
        </text>
        {scene}
        {dots}
      </svg>
      <div className="road-caption">
        <div className="step-title">{s.title}</div>
        <p>{s.caption}</p>
        {step === STEPS.length - 1 && (
          <a className="deep-dive-btn" href="./index.html#why-cells">
            <Icon name="arrow-right-circle" size={16} /> See the full interactive deep dive
          </a>
        )}
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className={`value ${s.domains > 1 ? 'good' : ''}`}>{s.domains}</div>
          <div className="label">failure domain{s.domains > 1 ? 's' : ''}</div>
        </div>
        <div className="stat">
          <div className={`value ${s.blast === '25%' ? 'good' : step >= 3 ? 'bad' : ''}`}>{s.blast}</div>
          <div className="label">{s.blastLabel}</div>
        </div>
      </div>
    </div>
  );
};

export default RoadToCells;
