import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SectionResultsBox, SectionVoteBox } from './SectionVote';
import VoteDock from './VoteDock';
import ResultsPanel from './ResultsPanel';
import { useVote } from './VoteContext';
import { SectionInfo } from './types';

/**
 * Mounts the overlay onto the page. The caller passes the FULL section
 * registry (every votable section, whether or not its view has mounted yet)
 * plus the ids that are currently in the DOM: all sections register in the
 * vote context immediately (progress reads n/{all}, results list everything,
 * ballots export every id), while vote/results boxes portal only into the
 * sections that exist — re-discovered whenever `mountedIds` grows.
 */
const VoteOverlay: React.FC<{
  /** Every votable section, in order, with display titles. */
  sections: SectionInfo[];
  /** Section ids whose views are currently mounted in the DOM. */
  mountedIds: readonly string[];
}> = ({ sections, mountedIds }) => {
  const { enabled, mode, setSections } = useVote();
  const [slots, setSlots] = useState<Array<{ info: SectionInfo; el: HTMLElement }>>([]);

  // Register the complete list — not just what is on screen.
  useEffect(() => {
    if (!enabled) return;
    setSections(sections);
  }, [enabled, sections, setSections]);

  // Slot discovery re-runs as views lazy-mount.
  useEffect(() => {
    if (!enabled) return;
    const found: Array<{ info: SectionInfo; el: HTMLElement }> = [];
    for (const info of sections) {
      const section = document.getElementById(info.id);
      if (!section) continue;
      let slot = section.querySelector<HTMLElement>(':scope > .vote-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'vote-slot';
        section.appendChild(slot);
      }
      found.push({ info, el: slot });
    }
    setSlots(found);
  }, [enabled, sections, mountedIds]);

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
