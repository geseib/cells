import React from 'react';
import { GROUPS, SECTIONS } from './registry';

/**
 * The main menu: four group blocks of intro cards, one per section, in
 * reading order. Cards are plain anchors — the hash is the router.
 */
const MenuView: React.FC = () => (
  <div className="menu-view">
    <span className="view-anchor" tabIndex={-1}>Menu</span>
    <div className="menu-intro">
      <a className="start-pill" href="#why-cells" data-testid="start-pill">
        Start with 01 · Why cells →
      </a>
    </div>
    {GROUPS.map((group) => (
      <section key={group} className="menu-group" aria-label={group} data-testid="menu-group" data-group={group}>
        <h2 className="menu-group-title">{group}</h2>
        <div className="menu-grid">
          {SECTIONS.filter((s) => s.group === group).map((s) => (
            <a
              key={s.id}
              className="menu-card"
              href={`#${s.id}`}
              data-testid="menu-card"
              data-section={s.id}
            >
              <span className="menu-card-num" aria-hidden="true">{s.num}</span>
              <span className="menu-card-body">
                <span className="menu-card-title">{s.title}</span>
                <span className="menu-card-blurb">{s.blurb}</span>
              </span>
              {s.num === '01' && <span className="start-here">Start here</span>}
            </a>
          ))}
        </div>
      </section>
    ))}
  </div>
);

export default MenuView;
