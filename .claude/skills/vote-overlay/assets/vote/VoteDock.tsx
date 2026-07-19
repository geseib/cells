import React, { useRef, useState } from 'react';
import Icon from '../ui/icons';
import { useVote } from './VoteContext';

/**
 * The bottom-right dock: flip between casting votes and reading results.
 * Vote side: voter name, page progress, download, clear. Results side:
 * pick ballot files, manage them, open the summary panel.
 */
const VoteDock: React.FC = () => {
  const {
    mode,
    setMode,
    voter,
    setVoter,
    sections,
    votedCount,
    download,
    clearVotes,
    votes,
    ballots,
    addBallots,
    removeBallot,
    clearBallots,
    panelOpen,
    setPanelOpen,
  } = useVote();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadNote, setLoadNote] = useState('');

  if (mode === 'off') return null;

  const totalCast = Object.values(votes).reduce(
    (sum, page) => sum + Object.values(page).filter((e) => e.choice).length,
    0
  );

  return (
    <aside className="vote-dock" aria-label="Section voting">
      <div className="vote-dock-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'vote'}
          className={mode === 'vote' ? 'active' : ''}
          onClick={() => setMode('vote')}
        >
          <Icon name="check-square" size={13} /> Vote
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'results'}
          className={mode === 'results' ? 'active' : ''}
          onClick={() => setMode('results')}
        >
          <Icon name="bar-chart" size={13} /> Results
        </button>
        <button type="button" className="vote-dock-close" aria-label="Close voting overlay" onClick={() => setMode('off')}>
          <Icon name="x" size={13} />
        </button>
      </div>

      {mode === 'vote' && (
        <div className="vote-dock-body">
          <label className="vote-field">
            <span>Your name</span>
            <input
              type="text"
              value={voter}
              placeholder="anonymous"
              onChange={(e) => setVoter(e.target.value)}
            />
          </label>
          <div className="vote-progress">
            <div className="vote-progress-meter" role="img" aria-label={`${votedCount} of ${sections.length} sections voted`}>
              <span style={{ width: sections.length ? `${(votedCount / sections.length) * 100}%` : 0 }} />
            </div>
            <span className="vote-box-meta">
              {votedCount} of {sections.length} on this page · {totalCast} total
            </span>
          </div>
          <div className="vote-dock-actions">
            <button type="button" onClick={download} disabled={totalCast === 0}>
              <Icon name="download" size={13} /> Download JSON
            </button>
            {!confirmClear ? (
              <button type="button" onClick={() => setConfirmClear(true)} disabled={totalCast === 0}>
                <Icon name="trash" size={13} /> Clear
              </button>
            ) : (
              <button
                type="button"
                className="danger"
                onClick={() => {
                  clearVotes();
                  setConfirmClear(false);
                }}
              >
                <Icon name="trash" size={13} /> Clear all {totalCast}?
              </button>
            )}
          </div>
        </div>
      )}

      {mode === 'results' && (
        <div className="vote-dock-body">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={async (e) => {
              if (!e.target.files?.length) return;
              const { added, rejected } = await addBallots(e.target.files);
              setLoadNote(
                rejected
                  ? `${added} loaded, ${rejected} not vote files`
                  : `${added} file${added === 1 ? '' : 's'} loaded`
              );
              e.target.value = '';
            }}
          />
          <div className="vote-dock-actions">
            <button type="button" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={13} /> Select vote files
            </button>
            <button
              type="button"
              className={panelOpen ? 'active' : ''}
              aria-pressed={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <Icon name="panel-right" size={13} /> Summary
            </button>
          </div>
          {loadNote && <div className="vote-box-meta">{loadNote}</div>}
          {ballots.length === 0 ? (
            <div className="vote-box-meta">
              No vote files loaded. Results appear inline under each section and in the summary panel.
            </div>
          ) : (
            <ul className="vote-ballots">
              {ballots.map((b, i) => (
                <li key={`${b.voter}-${b.exportedAt}`}>
                  <Icon name="users" size={12} />
                  <span className="vote-ballot-name">{b.voter}</span>
                  <span className="vote-box-meta">
                    {Object.values(b.pages).reduce((n, p) => n + Object.keys(p.sections).length, 0)} sections
                  </span>
                  <button type="button" aria-label={`Remove ${b.voter}'s file`} onClick={() => removeBallot(i)}>
                    <Icon name="x" size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {ballots.length > 0 && (
            <div className="vote-dock-actions">
              <button type="button" onClick={clearBallots}>
                <Icon name="trash" size={13} /> Unload all
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};

export default VoteDock;
