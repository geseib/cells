import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SectionResultsBox, SectionVoteBox } from './SectionVote';
import VoteDock from './VoteDock';
import ResultsPanel from './ResultsPanel';
import { useVote } from './VoteContext';
import { SectionInfo } from './types';

/**
 * Mounts the overlay onto the page: discovers votable sections in the DOM
 * (no per-section wiring — any element matching `sectionSelector` with an id
 * gets a slot appended), then portals a vote box or a results box into each
 * slot depending on the mode. The dock and summary panel ride along.
 */
const VoteOverlay: React.FC<{
  /** e.g. 'section.lesson' — elements must carry an id */
  sectionSelector: string;
  /** how to read a human title from a section; default: first h2 */
  titleSelector?: string;
}> = ({ sectionSelector, titleSelector = 'h2' }) => {
  const { enabled, mode, setSections } = useVote();
  const [slots, setSlots] = useState<Array<{ info: SectionInfo; el: HTMLElement }>>([]);

  useEffect(() => {
    if (!enabled) return;
    const found: Array<{ info: SectionInfo; el: HTMLElement }> = [];
    document.querySelectorAll<HTMLElement>(sectionSelector).forEach((section) => {
      if (!section.id) return;
      let slot = section.querySelector<HTMLElement>(':scope > .vote-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'vote-slot';
        section.appendChild(slot);
      }
      const title = section.querySelector(titleSelector)?.textContent?.trim() || section.id;
      found.push({ info: { id: section.id, title }, el: slot });
    });
    setSlots(found);
    setSections(found.map((f) => f.info));
  }, [enabled, sectionSelector, titleSelector, setSections]);

  if (!enabled) return null;

  return (
    <>
      {mode !== 'off' &&
        slots.map(({ info, el }) =>
          createPortal(
            mode === 'vote' ? (
              <SectionVoteBox sectionId={info.id} title={info.title} />
            ) : (
              <SectionResultsBox sectionId={info.id} title={info.title} />
            ),
            el,
            info.id
          )
        )}
      <VoteDock />
      <ResultsPanel />
    </>
  );
};

export default VoteOverlay;
