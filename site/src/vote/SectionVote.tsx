import React, { useEffect, useState } from 'react';
import Icon, { IconName } from '../ui/icons';
import { useVote } from './VoteContext';
import { CHOICES, Choice, tallySection } from './types';

const CHOICE_META: Record<Choice, { label: string; icon: IconName; varName: string }> = {
  agree: { label: 'Agree', icon: 'thumbs-up', varName: 'var(--good)' },
  disagree: { label: 'Disagree', icon: 'thumbs-down', varName: 'var(--critical)' },
  unsure: { label: 'Unsure', icon: 'circle-help', varName: 'var(--degraded)' },
};

/** The per-section voting box (vote mode). */
export const SectionVoteBox: React.FC<{ sectionId: string; title: string }> = ({ sectionId, title }) => {
  const { votes, pageId, castVote, setComment } = useVote();
  const entry = votes[pageId]?.[sectionId] ?? {};
  const [commentOpen, setCommentOpen] = useState(Boolean(entry.comment));

  return (
    <div className="vote-box" data-section={sectionId}>
      <div className="vote-box-head">
        <Icon name="check-square" size={14} />
        <span className="vote-box-title">Your take: {title}</span>
      </div>
      <div className="vote-actions">
        {CHOICES.map((c) => {
          const meta = CHOICE_META[c];
          const active = entry.choice === c;
          return (
            <button
              key={c}
              type="button"
              className={`vote-choice${active ? ' active' : ''}`}
              style={active ? ({ '--choice': meta.varName } as React.CSSProperties) : undefined}
              aria-pressed={active}
              onClick={() => castVote(sectionId, c)}
            >
              <Icon name={meta.icon} size={14} /> {meta.label}
            </button>
          );
        })}
        <button
          type="button"
          className={`vote-choice vote-comment-btn${commentOpen || entry.comment ? ' active' : ''}`}
          aria-expanded={commentOpen}
          onClick={() => setCommentOpen((o) => !o)}
        >
          <Icon name="message-square" size={14} /> Comment
        </button>
      </div>
      {commentOpen && (
        <textarea
          className="vote-comment"
          placeholder="What would you change, add, or challenge in this section?"
          value={entry.comment ?? ''}
          rows={2}
          onChange={(e) => setComment(sectionId, e.target.value)}
        />
      )}
    </div>
  );
};

/** Stacked for/against/undecided bar. */
export const TallyBar: React.FC<{ agree: number; disagree: number; unsure: number; compact?: boolean }> = ({
  agree,
  disagree,
  unsure,
  compact,
}) => {
  const total = agree + disagree + unsure;
  if (total === 0) {
    return <div className={`vote-bar empty${compact ? ' compact' : ''}`} aria-label="no votes yet" />;
  }
  return (
    <div
      className={`vote-bar${compact ? ' compact' : ''}`}
      role="img"
      aria-label={`${agree} agree, ${disagree} disagree, ${unsure} unsure`}
    >
      {agree > 0 && <span style={{ width: `${(agree / total) * 100}%`, background: 'var(--good)' }} />}
      {disagree > 0 && <span style={{ width: `${(disagree / total) * 100}%`, background: 'var(--critical)' }} />}
      {unsure > 0 && <span style={{ width: `${(unsure / total) * 100}%`, background: 'var(--degraded)' }} />}
    </div>
  );
};

/** The per-section results box (results mode): bar + comment carousel. */
export const SectionResultsBox: React.FC<{ sectionId: string; title: string }> = ({ sectionId, title }) => {
  const { ballots, pageId } = useVote();
  const tally = tallySection(ballots, pageId, sectionId);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [ballots.length]);

  const n = tally.comments.length;
  const current = n > 0 ? tally.comments[((idx % n) + n) % n] : null;

  return (
    <div className="vote-box results" data-section={sectionId}>
      <div className="vote-box-head">
        <Icon name="bar-chart" size={14} />
        <span className="vote-box-title">Votes: {title}</span>
        <span className="vote-box-meta">
          {tally.total === 0 ? 'no votes loaded' : `${tally.total} vote${tally.total === 1 ? '' : 's'}`}
        </span>
      </div>
      <TallyBar agree={tally.agree} disagree={tally.disagree} unsure={tally.unsure} />
      <div className="vote-legend">
        <span><i style={{ background: 'var(--good)' }} /> {tally.agree} agree</span>
        <span><i style={{ background: 'var(--critical)' }} /> {tally.disagree} disagree</span>
        <span><i style={{ background: 'var(--degraded)' }} /> {tally.unsure} unsure</span>
      </div>
      {current && (
        <div className="vote-carousel">
          <button
            type="button"
            className="vote-nav"
            onClick={() => setIdx((i) => i - 1)}
            disabled={n < 2}
            aria-label="Previous comment"
          >
            <Icon name="chevron-left" size={15} />
          </button>
          <div className="vote-quote">
            <div className="vote-quote-head">
              <strong>{current.voter}</strong>
              <span className="vote-chip" style={{ color: CHOICE_META[current.choice].varName }}>
                <Icon name={CHOICE_META[current.choice].icon} size={12} /> {CHOICE_META[current.choice].label}
              </span>
              <span className="vote-box-meta">
                {((idx % n) + n) % n + 1} of {n}
              </span>
            </div>
            <div className="vote-quote-text">{current.comment}</div>
          </div>
          <button
            type="button"
            className="vote-nav"
            onClick={() => setIdx((i) => i + 1)}
            disabled={n < 2}
            aria-label="Next comment"
          >
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      )}
    </div>
  );
};
