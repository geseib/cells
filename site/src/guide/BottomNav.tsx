import React from 'react';
import { SECTIONS } from './registry';

/**
 * In-flow section navigation: [← prev] [Menu] [next →]. Plain anchors; the
 * hash router does the rest. NOT sticky — a fixed bar would cover the sims'
 * controls. First view leaves the prev slot empty; the last view's "next"
 * loops back to the menu.
 */
const BottomNav: React.FC<{ current: string }> = ({ current }) => {
  const idx = SECTIONS.findIndex((s) => s.id === current);
  const prev = idx > 0 ? SECTIONS[idx - 1] : null;
  const next = idx >= 0 && idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;
  return (
    <nav className="bottom-nav" aria-label="Section navigation">
      {prev ? (
        <a className="bn-link bn-prev" data-testid="nav-prev" href={`#${prev.id}`}>
          <span className="bn-dir">← Previous</span>
          <span className="bn-label">{prev.num} · {prev.title}</span>
        </a>
      ) : (
        <span className="bn-spacer" aria-hidden="true" />
      )}
      <a className="bn-link bn-menu" data-testid="nav-menu" href="#menu">
        Menu
      </a>
      {next ? (
        <a className="bn-link bn-next" data-testid="nav-next" href={`#${next.id}`}>
          <span className="bn-dir">Next →</span>
          <span className="bn-label">{next.num} · {next.title}</span>
        </a>
      ) : (
        <a className="bn-link bn-next" data-testid="nav-next" href="#menu">
          <span className="bn-dir">Back to menu ↺</span>
          <span className="bn-label">You've reached the end</span>
        </a>
      )}
    </nav>
  );
};

export default BottomNav;
