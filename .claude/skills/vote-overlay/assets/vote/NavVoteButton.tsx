import React from 'react';
import Icon from '../ui/icons';
import { useVoteOptional } from './VoteContext';

/**
 * The top-menu voting toggle. Renders nothing unless the feature flag is up;
 * when it is, toggles the overlay between off and vote mode (the dock takes
 * it from there).
 */
const NavVoteButton: React.FC = () => {
  const vote = useVoteOptional();
  if (!vote?.enabled) return null;
  const on = vote.mode !== 'off';
  return (
    <button
      type="button"
      className={`nav-vote${on ? ' active' : ''}`}
      aria-pressed={on}
      title={on ? 'Hide the voting overlay' : 'Show the voting overlay'}
      onClick={() => vote.setMode(on ? 'off' : 'vote')}
    >
      <Icon name="check-square" size={14} /> Voting
    </button>
  );
};

export default NavVoteButton;
