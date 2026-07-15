import React, { createContext, useId, useState } from 'react';
import Icon from './icons';
import { usePrefersReducedMotion } from '../sections/BeyondCells';

/**
 * Whether the nearest enclosing Sidequest is expanded. Children that are
 * expensive to compute (e.g. the algorithm-zoo mini-demos) read this to stay
 * lazy until the reader actually opens the deep-dive.
 */
export const SidequestOpenContext = createContext(false);

/**
 * Sidequest: an optional deep-dive that stays out of the main reading flow.
 * The kicker + title + blurb are always visible; clicking the summary row (a
 * real <button>, so Enter/Space work for free) expands the body. The height
 * animation is the CSS grid 0fr→1fr trick; the global reduced-motion rule in
 * styles.css strips the transition, and the hook below doubles down inline.
 *
 * Two sizes share this component: the default compact chrome for true
 * sidequests, and a larger variant (className="sidequest-lg", usually with a
 * custom kicker) for numbered sections that collapse their deep content —
 * e.g. 06 · the algorithm zoo. The blurb renders in a <div>, so it may hold
 * paragraphs.
 */
const Sidequest: React.FC<{
  id: string;
  title: string;
  blurb: React.ReactNode;
  /** Kicker line above the title; defaults to the sidequest chrome. */
  kicker?: React.ReactNode;
  /** Extra class(es) on the wrapper, e.g. "sidequest-lg". */
  className?: string;
  children: React.ReactNode;
}> = ({ id, title, blurb, kicker = 'Sidequest · optional deep-dive', className, children }) => {
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const bodyId = `${id}-body-${useId()}`;

  return (
    <div
      className={`sidequest panel${className ? ` ${className}` : ''}${open ? ' open' : ''}`}
      id={id}
    >
      <button
        type="button"
        className="sidequest-summary"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="sidequest-heading">
          <div className="sidequest-kicker">{kicker}</div>
          <div className="sidequest-title">{title}</div>
          <div className="sidequest-blurb">{blurb}</div>
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
        <div className="sidequest-body">
          <SidequestOpenContext.Provider value={open}>{children}</SidequestOpenContext.Provider>
        </div>
      </div>
    </div>
  );
};

export default Sidequest;
