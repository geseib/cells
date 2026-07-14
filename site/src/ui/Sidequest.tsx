import React, { useId, useState } from 'react';
import Icon from './icons';
import { usePrefersReducedMotion } from '../sections/BeyondCells';

/**
 * Sidequest: an optional deep-dive that stays out of the main reading flow.
 * The kicker + title + blurb are always visible; clicking the summary row (a
 * real <button>, so Enter/Space work for free) expands the body. The height
 * animation is the CSS grid 0fr→1fr trick; the global reduced-motion rule in
 * styles.css strips the transition, and the hook below doubles down inline.
 */
const Sidequest: React.FC<{
  id: string;
  title: string;
  blurb: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, blurb, children }) => {
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const bodyId = `${id}-body-${useId()}`;

  return (
    <div className={`sidequest panel${open ? ' open' : ''}`} id={id}>
      <button
        type="button"
        className="sidequest-summary"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="sidequest-heading">
          <div className="sidequest-kicker">Sidequest · optional deep-dive</div>
          <div className="sidequest-title">{title}</div>
          <p className="sidequest-blurb">{blurb}</p>
        </div>
        <Icon name="chevron-down" size={20} className="sidequest-chevron" />
      </button>
      <div
        className="sidequest-body-wrap"
        id={bodyId}
        role="region"
        aria-label={title}
        aria-hidden={!open}
        style={reduced ? { transition: 'none' } : undefined}
      >
        <div className="sidequest-body">{children}</div>
      </div>
    </div>
  );
};

export default Sidequest;
