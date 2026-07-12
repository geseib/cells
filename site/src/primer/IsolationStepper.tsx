import React, { useState } from 'react';
import { CELL_COLOR_VARS, FAILED_COLOR } from '../sim/simulation';
import Icon from '../ui/icons';

/**
 * "Aren't these all the same thing?" — a left/right stepper through the
 * sibling concepts (AZ, region, microservice, shard, namespace, cell).
 *
 * The visual argument on every step is the same two-color sentence:
 * solid boxes are what this concept isolates; the dashed red element is the
 * dependency it leaves coupled. Each concept walls off exactly one dependency
 * class and leaves the system-level coupling in place — until the last step,
 * where cells/stamps compose all of the previous walls into complete replicas
 * of the whole system and the only dashed thing left is a thin router.
 */

const W = 560;
const H = 252;

interface IsoStep {
  pill: string;
  title: string;
  isolates: string;
  coupled: string;
  caption: string;
  /** Last step: the "still coupled" fact is the good news, not the gap. */
  payoff?: boolean;
}

const STEPS: IsoStep[] = [
  {
    pill: 'Availability Zone',
    title: 'Separate buildings, shared brain.',
    isolates: 'Physical dependencies — each zone has its own power, cooling, and network.',
    coupled:
      'The control plane. Zonal data planes usually hang off one regional control plane, ' +
      'so a control-plane bug reaches every AZ at once.',
    caption:
      'A fire takes out one zone and the other two keep serving — that’s the wall working. ' +
      'But the wall is physical, not logical: push a bad control-plane change and all three ' +
      'zones learn about it in the same second.',
  },
  {
    pill: 'Region',
    title: 'The control plane finally splits too.',
    isolates:
      'Control plane and physics — regions run separate control planes, so a metro-scale ' +
      'disaster or a regional control-plane failure stays regional.',
    coupled:
      'Cross-region routing and data replication. The provider hands you two islands; ' +
      'the bridge between them is your problem.',
    caption:
      'This is the strongest wall the provider will build for you: independent machinery for ' +
      'changing the system, not just running it. The price is that nothing spans it for free — ' +
      'failover, replication, and consistency across regions are now your architecture.',
  },
  {
    pill: 'Microservice',
    title: 'Fault isolation for one function.',
    isolates:
      'One function’s faults — a memory leak in payments can’t crash the catalog’s process.',
    coupled:
      'The system. Synchronous call chains re-couple the services: one slow dependency ' +
      'and the whole request path waits behind it.',
    caption:
      'Every user’s request still threads through many services, so the isolation is per ' +
      'process, not per request. The complexity didn’t leave the system — it moved into the ' +
      'network between the boxes.',
  },
  {
    pill: 'Shard',
    title: 'The data splits; the system doesn’t.',
    isolates:
      'The data — one key range’s hot key, corruption, or growth stays in one shard, ' +
      'and you scale by adding shards.',
    coupled:
      'Compute and control plane are often still shared — and the system-level ' +
      'complexity stays exactly where it was.',
    caption:
      'Sharding is real isolation and real scaling — for one tier. A bad deploy, a poison ' +
      'request, or a config mistake still lands on the shared compute in front of every shard.',
  },
  {
    pill: 'K8s namespace',
    title: 'A fence inside one cluster.',
    isolates:
      'Quotas and API objects — team-a can’t eat team-b’s resource budget or collide ' +
      'with its names.',
    coupled:
      'The cluster’s control plane. One API server, one etcd, one scheduler — for everyone.',
    caption:
      'Useful multi-tenancy plumbing, and the weakest wall on this page: a namespace is an ' +
      'entry in a shared database, not a failure domain. When the cluster’s control plane has ' +
      'a bad day, every namespace has the same bad day.',
  },
  {
    pill: 'Cell / stamp',
    title: 'Compose them all into whole replicas.',
    isolates:
      'The whole system, per slice of clients — each cell stacks AZs, services, and shards ' +
      'into a complete replica, so a bad deploy, poison request, or data corruption stays ' +
      'inside one.',
    coupled:
      'Only the router — one thin layer mapping client → cell, kept small and boring. ' +
      'You decide the slice.',
    caption:
      'This is the move the others were missing: not another axis of splitting, but the ' +
      'composition. A cell (Azure says “deployment stamp”) takes every isolation and scaling ' +
      'unit above and groups them into N replicas of the entire system — isolation at the ' +
      'system level, which is where the outages you read about actually live.',
    payoff: true,
  },
];

/* ---- shared drawing helpers -------------------------------------- */

/** Solid box: the thing this concept isolates. */
const Iso: React.FC<{
  x: number; y: number; w: number; h: number; color: string;
  label?: string; sub?: string; labelTop?: boolean;
}> = ({ x, y, w, h, color, label, sub, labelTop }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={7} fill="var(--surface-1)"
      stroke={color} strokeWidth={1.6} />
    {label && (
      <text x={x + w / 2} y={y + (sub || labelTop ? 16 : h / 2 + 4)} textAnchor="middle"
        fontSize={10.5} fontWeight={600} fill="var(--ink)">{label}</text>
    )}
    {sub && (
      <text x={x + w / 2} y={y + 28} textAnchor="middle" fontSize={9}
        fill="var(--muted)">{sub}</text>
    )}
  </g>
);

/** Dashed box/bar: the dependency that stays shared. */
const Shared: React.FC<{
  x: number; y: number; w: number; h: number; label: string; sub?: string;
}> = ({ x, y, w, h, label, sub }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={7} fill="none"
      stroke={FAILED_COLOR} strokeWidth={1.4} strokeDasharray="5 4" />
    <text x={x + w / 2} y={y + h / 2 + (sub ? -2 : 3.5)} textAnchor="middle"
      fontSize={10} fontWeight={600} fill={FAILED_COLOR}>{label}</text>
    {sub && (
      <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" fontSize={8.5}
        fill={FAILED_COLOR} opacity={0.85}>{sub}</text>
    )}
  </g>
);

/** Small filled chip inside an isolated unit (the "own X" dialect). */
const Chip: React.FC<{ cx: number; y: number; w: number; color: string; label: string }> = ({
  cx, y, w, color, label,
}) => (
  <g>
    <rect x={cx - w / 2} y={y} width={w} height={20} rx={4} fill={color} />
    <text x={cx} y={y + 13.5} textAnchor="middle" fontSize={9} fontWeight={600}
      fill="#fff">{label}</text>
  </g>
);

const dashedLink = (key: string, d: string) => (
  <path key={key} d={d} fill="none" stroke={FAILED_COLOR} strokeWidth={1.2}
    strokeDasharray="4 4" opacity={0.8} />
);

/* ---- one diagram per concept -------------------------------------- */

const AzScene: React.FC = () => {
  const centers = [125, 280, 435];
  return (
    <>
      {centers.map((cx, i) => (
        <g key={i}>
          <Iso x={cx - 62} y={34} w={124} h={118} color={CELL_COLOR_VARS[i]}
            label={`AZ ${'abc'[i]}`} labelTop />
          <Chip cx={cx} y={62} w={92} color={CELL_COLOR_VARS[i]} label="own power" />
          <Chip cx={cx} y={88} w={92} color={CELL_COLOR_VARS[i]} label="own cooling" />
          <Chip cx={cx} y={114} w={92} color={CELL_COLOR_VARS[i]} label="own network" />
          {dashedLink(`az-${i}`, `M ${cx} 152 V 186`)}
        </g>
      ))}
      <Shared x={70} y={188} w={420} h={38} label="one regional control plane"
        sub="a bug here hits all three zones at once" />
    </>
  );
};

const RegionScene: React.FC = () => {
  const regions = [{ x: 42, name: 'us-east-1' }, { x: 318, name: 'eu-west-1' }];
  return (
    <>
      {regions.map(({ x, name }, i) => (
        <g key={name}>
          <Iso x={x} y={34} w={200} h={158} color={CELL_COLOR_VARS[i]} />
          <text x={x + 100} y={178} textAnchor="middle" fontSize={10.5} fontWeight={600}
            fill="var(--ink)">Region {name}</text>
          <Chip cx={x + 100} y={48} w={156} color={CELL_COLOR_VARS[i]} label="own control plane" />
          {[0, 1, 2].map((k) => (
            <rect key={k} x={x + 22 + k * 54} y={92} width={48} height={64} rx={5}
              fill="var(--surface-1)" stroke={CELL_COLOR_VARS[i]} strokeWidth={1.2} />
          ))}
          {[0, 1, 2].map((k) => (
            <text key={`t-${k}`} x={x + 46 + k * 54} y={128} textAnchor="middle"
              fontSize={9} fill="var(--ink-2)">AZ {'abc'[k]}</text>
          ))}
        </g>
      ))}
      {dashedLink('rr', 'M 246 112 H 314')}
      <path d="M 250 108 244 112 250 116 M 310 108 316 112 310 116" fill="none"
        stroke={FAILED_COLOR} strokeWidth={1.2} />
      <text x={280} y={100} textAnchor="middle" fontSize={9} fontWeight={600}
        fill={FAILED_COLOR}>routing +</text>
      <text x={280} y={130} textAnchor="middle" fontSize={9} fontWeight={600}
        fill={FAILED_COLOR}>replication</text>
      <text x={280} y={216} textAnchor="middle" fontSize={9.5} fill={FAILED_COLOR}>
        the bridge between the islands is your problem now
      </text>
    </>
  );
};

const MicroserviceScene: React.FC = () => {
  const centers = [100, 220, 340, 460];
  const names = ['auth', 'orders', 'payments', 'catalog'];
  const y = 96;
  return (
    <>
      <circle cx={40} cy={34} r={6} fill="var(--baseline)" />
      <text x={54} y={38} fontSize={9.5} fill="var(--muted)">one request</text>
      {centers.map((cx, i) => (
        <g key={i}>
          <Iso x={cx - 46} y={y} w={92} h={52} color={CELL_COLOR_VARS[i]} label={names[i]}
            sub="own process" />
        </g>
      ))}
      {/* the synchronous chain that re-couples them */}
      {dashedLink('in', `M 40 42 C 40 80, ${centers[0]} 60, ${centers[0]} ${y - 2}`)}
      {centers.slice(0, -1).map((cx, i) =>
        dashedLink(`ch-${i}`, `M ${cx + 46} ${y + 26} H ${centers[i + 1] - 46}`)
      )}
      {centers.slice(1).map((cx, i) => (
        <path key={`ar-${i}`} d={`M ${cx - 52} ${y + 22} l 6 4 -6 4`} fill="none"
          stroke={FAILED_COLOR} strokeWidth={1.2} />
      ))}
      <text x={280} y={182} textAnchor="middle" fontSize={9.5} fontWeight={600}
        fill={FAILED_COLOR}>the synchronous call chain couples them right back together</text>
      <text x={280} y={198} textAnchor="middle" fontSize={9} fill="var(--muted)">
        payments slow → auth, orders, and the user all wait
      </text>
    </>
  );
};

const ShardScene: React.FC = () => {
  const centers = [160, 280, 400];
  const ranges = ['keys a–h', 'keys i–q', 'keys r–z'];
  const topY = 140;
  return (
    <>
      <Shared x={90} y={38} w={380} h={44} label="shared compute + control plane"
        sub="every request crosses this before it reaches a shard" />
      {centers.map((cx, i) => (
        <g key={i}>
          {dashedLink(`sc-${i}`, `M ${cx} 82 V ${topY - 12}`)}
          <path
            d={`M ${cx - 44} ${topY} v 52 a 44 10 0 0 0 88 0 v -52`}
            fill="var(--surface-1)" stroke={CELL_COLOR_VARS[i]} strokeWidth={1.6} />
          <ellipse cx={cx} cy={topY} rx={44} ry={10} fill="var(--surface-1)"
            stroke={CELL_COLOR_VARS[i]} strokeWidth={1.6} />
          <text x={cx} y={topY + 34} textAnchor="middle" fontSize={10} fontWeight={600}
            fill="var(--ink)">{ranges[i]}</text>
          <text x={cx} y={topY + 48} textAnchor="middle" fontSize={9}
            fill="var(--muted)">own data</text>
        </g>
      ))}
    </>
  );
};

const NamespaceScene: React.FC = () => {
  const centers = [145, 280, 415];
  return (
    <>
      <rect x={50} y={30} width={460} height={192} rx={9} fill="none"
        stroke="var(--baseline)" strokeWidth={1.4} />
      <text x={64} y={48} fontSize={9.5} fill="var(--muted)">one Kubernetes cluster</text>
      <Shared x={80} y={58} w={400} h={36} label="API server · etcd · scheduler"
        sub="one control plane for everyone" />
      {centers.map((cx, i) => (
        <g key={i}>
          {dashedLink(`ns-${i}`, `M ${cx} 94 V 126`)}
          <Iso x={cx - 56} y={128} w={112} h={72} color={CELL_COLOR_VARS[i]}
            label={`ns: team-${'abc'[i]}`} labelTop />
          <Chip cx={cx} y={164} w={80} color={CELL_COLOR_VARS[i]} label="own quota" />
        </g>
      ))}
    </>
  );
};

const CellScene: React.FC = () => {
  const centers = [130, 280, 430];
  const top = 78;
  const chips = ['own services', 'own data', 'own deploys'];
  return (
    <>
      <rect x={60} y={30} width={440} height={22} rx={6} fill="var(--surface-1)"
        stroke="var(--baseline)" strokeWidth={1.5} />
      <text x={280} y={45} textAnchor="middle" fontSize={10.5} fontWeight={600}
        fill="var(--ink)">request router — thin, boring, the only shared piece</text>
      {centers.map((cx, i) => (
        <g key={i}>
          <path d={`M ${cx} 52 V ${top - 2}`} stroke={CELL_COLOR_VARS[i]}
            strokeWidth={2.2} fill="none" />
          <Iso x={cx - 62} y={top} w={124} h={140} color={CELL_COLOR_VARS[i]} />
          <text x={cx} y={top + 17} textAnchor="middle" fontSize={10.5} fontWeight={700}
            fill="var(--ink)">Cell {'ABC'[i]}</text>
          {chips.map((label, row) => (
            <Chip key={row} cx={cx} y={top + 26 + row * 26} w={100}
              color={CELL_COLOR_VARS[i]} label={label} />
          ))}
          <text x={cx} y={top + 122} textAnchor="middle" fontSize={8.5}
            fill="var(--muted)">a complete replica</text>
          <text x={cx} y={top + 133} textAnchor="middle" fontSize={8.5}
            fill="var(--muted)">of the whole system</text>
        </g>
      ))}
      <text x={280} y={244} textAnchor="middle" fontSize={9.5} fill="var(--good)"
        fontWeight={600}>nothing dashed left inside — the walls are system-wide</text>
    </>
  );
};

const SCENES: React.FC[] = [AzScene, RegionScene, MicroserviceScene, ShardScene, NamespaceScene, CellScene];

/* ---- the stepper --------------------------------------------------- */

const IsolationStepper: React.FC = () => {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const Scene = SCENES[step];
  const prev = () => setStep((v) => Math.max(0, v - 1));
  const next = () => setStep((v) => Math.min(STEPS.length - 1, v + 1));

  return (
    <div
      className="panel iso-stepper"
      role="group"
      aria-label="What each concept isolates, and what it leaves coupled"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      }}
    >
      <div className="controls">
        <button onClick={prev} disabled={step === 0}>← Prev</button>
        <div className="stepper-pills">
          {STEPS.map((st, i) => (
            <button
              key={st.pill}
              className={`step-pill${i === step ? ' active' : ''}`}
              aria-pressed={i === step}
              onClick={(e) => { setStep(i); (e.currentTarget as HTMLElement).blur(); }}
            >
              {st.pill}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button
          className={step < STEPS.length - 1 ? 'primary' : ''}
          onClick={next}
          disabled={step === STEPS.length - 1}
        >
          Next →
        </button>
      </div>
      <svg
        className="iso-svg"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${s.pill}: ${s.title}`}
      >
        <Scene />
      </svg>
      <div className="iso-legend" aria-hidden="true">
        <span className="iso-legend-item"><span className="swatch solid" /> isolated — its own copy</span>
        <span className="iso-legend-item"><span className="swatch dashed" /> still shared — the coupling that remains</span>
        <span className="iso-key-hint">← → arrow keys work while this panel is focused</span>
      </div>
      <div className="road-caption">
        <div className="step-title">{s.pill} — {s.title}</div>
        <div className="iso-facts">
          <div className="iso-fact isolates">
            <div className="iso-fact-label"><Icon name="check-circle" size={14} /> Isolates</div>
            <p>{s.isolates}</p>
          </div>
          <div className={`iso-fact ${s.payoff ? 'payoff' : 'coupled'}`}>
            <div className="iso-fact-label">
              <Icon name={s.payoff ? 'compass' : 'link'} size={14} />
              {s.payoff ? ' The only shared piece' : ' Still coupled'}
            </div>
            <p>{s.coupled}</p>
          </div>
        </div>
        <p>{s.caption}</p>
      </div>
    </div>
  );
};

export default IsolationStepper;
