/** Shared types + the export-file schema for the voting overlay. */

export type Choice = 'agree' | 'disagree' | 'unsure';

export const CHOICES: Choice[] = ['agree', 'disagree', 'unsure'];

export interface SectionVoteEntry {
  choice?: Choice;
  comment?: string;
}

/** votes[pageId][sectionId] */
export type VoteMap = Record<string, Record<string, SectionVoteEntry>>;

export interface SectionInfo {
  id: string;
  title: string;
}

/** The downloaded/loaded ballot file. */
export interface Ballot {
  format: 'vote-overlay/1';
  site: string;
  voter: string;
  exportedAt: string;
  pages: Record<
    string,
    {
      title: string;
      sections: Record<string, { title: string; choice?: Choice; comment?: string }>;
    }
  >;
}

export interface SectionTally {
  agree: number;
  disagree: number;
  unsure: number;
  total: number;
  comments: Array<{ voter: string; choice: Choice; comment: string }>;
}

export function tallySection(ballots: Ballot[], pageId: string, sectionId: string): SectionTally {
  const t: SectionTally = { agree: 0, disagree: 0, unsure: 0, total: 0, comments: [] };
  for (const b of ballots) {
    const entry = b.pages[pageId]?.sections[sectionId];
    if (!entry?.choice) continue;
    t[entry.choice] += 1;
    t.total += 1;
    if (entry.comment?.trim()) {
      t.comments.push({ voter: b.voter || 'anonymous', choice: entry.choice, comment: entry.comment.trim() });
    }
  }
  return t;
}

export function isBallot(x: unknown): x is Ballot {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as Ballot).format === 'vote-overlay/1' &&
    typeof (x as Ballot).pages === 'object'
  );
}
