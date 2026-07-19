import React from 'react';
import Icon from '../ui/icons';
import { TallyBar } from './SectionVote';
import { useVote } from './VoteContext';
import { tallySection } from './types';

/**
 * The right-side summary: every page and section across the loaded ballots,
 * with stacked tallies. Clicking a section on the current page scrolls to it.
 */
const ResultsPanel: React.FC = () => {
  const { mode, panelOpen, setPanelOpen, ballots, sections, pageId, pageTitle } = useVote();
  if (mode !== 'results' || !panelOpen) return null;

  // Pages present in the ballots, with the current page always listed first.
  const pageIds = new Set<string>([pageId]);
  for (const b of ballots) for (const pid of Object.keys(b.pages)) pageIds.add(pid);

  const sectionsFor = (pid: string): Array<{ id: string; title: string }> => {
    if (pid === pageId && sections.length) return sections;
    const seen = new Map<string, string>();
    for (const b of ballots) {
      for (const [sid, entry] of Object.entries(b.pages[pid]?.sections ?? {})) {
        if (!seen.has(sid)) seen.set(sid, entry.title || sid);
      }
    }
    return Array.from(seen, ([id, title]) => ({ id, title }));
  };

  const pageTitleFor = (pid: string): string => {
    if (pid === pageId) return pageTitle;
    for (const b of ballots) {
      const t = b.pages[pid]?.title;
      if (t) return t;
    }
    return pid;
  };

  return (
    <aside className="vote-panel" aria-label="Vote results summary">
      <div className="vote-panel-head">
        <Icon name="bar-chart" size={14} />
        <strong>Results</strong>
        <span className="vote-box-meta">
          {ballots.length} file{ballots.length === 1 ? '' : 's'}
        </span>
        <button type="button" aria-label="Close summary panel" onClick={() => setPanelOpen(false)}>
          <Icon name="x" size={13} />
        </button>
      </div>
      {ballots.length === 0 && (
        <p className="vote-box-meta" style={{ padding: '0 0.9rem' }}>
          Load vote files from the dock to see the tallies.
        </p>
      )}
      {Array.from(pageIds).map((pid) => {
        const secs = sectionsFor(pid);
        if (secs.length === 0) return null;
        return (
          <div key={pid} className="vote-panel-page">
            <div className="vote-panel-page-title">{pageTitleFor(pid)}</div>
            {secs.map((s) => {
              const t = tallySection(ballots, pid, s.id);
              const clickable = pid === pageId;
              return (
                <button
                  key={s.id}
                  type="button"
                  className="vote-panel-row"
                  disabled={!clickable}
                  onClick={() =>
                    document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  title={clickable ? 'Scroll to this section' : undefined}
                >
                  <span className="vote-panel-row-title">{s.title}</span>
                  <TallyBar agree={t.agree} disagree={t.disagree} unsure={t.unsure} compact />
                  <span className="vote-box-meta">
                    {t.total || '–'}
                    {t.comments.length > 0 && (
                      <>
                        {' · '}
                        <Icon name="message-square" size={10} /> {t.comments.length}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
};

export default ResultsPanel;
