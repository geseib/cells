import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { votingFlagEnabled } from './flags';
import { Ballot, Choice, SectionInfo, VoteMap, isBallot } from './types';

/**
 * Shared state for the voting overlay. Mode, voter name, and cast votes
 * persist in localStorage so switching pages (or reloading) keeps whatever
 * mode you were in. Loaded result ballots stay in memory only — re-select
 * the files after a reload.
 */

export type VoteMode = 'off' | 'vote' | 'results';

interface VoteContextValue {
  enabled: boolean;
  pageId: string;
  pageTitle: string;
  mode: VoteMode;
  setMode: (m: VoteMode) => void;
  voter: string;
  setVoter: (v: string) => void;
  votes: VoteMap;
  castVote: (sectionId: string, choice: Choice) => void;
  setComment: (sectionId: string, comment: string) => void;
  clearVotes: () => void;
  sections: SectionInfo[];
  setSections: (s: SectionInfo[]) => void;
  ballots: Ballot[];
  addBallots: (files: FileList | File[]) => Promise<{ added: number; rejected: number }>;
  removeBallot: (index: number) => void;
  clearBallots: () => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  download: () => void;
  votedCount: number;
}

const VoteContext = createContext<VoteContextValue | null>(null);

const STORAGE_KEY = 'check123-vote-state';

interface Persisted {
  mode: VoteMode;
  voter: string;
  votes: VoteMap;
  panelOpen: boolean;
  pageTitles: Record<string, string>;
}

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { mode: 'off', voter: '', votes: {}, panelOpen: false, pageTitles: {}, ...JSON.parse(raw) };
  } catch {
    /* fall through */
  }
  return { mode: 'off', voter: '', votes: {}, panelOpen: false, pageTitles: {} };
}

export const VoteProvider: React.FC<{
  pageId: string;
  pageTitle: string;
  siteName: string;
  children: React.ReactNode;
}> = ({ pageId, pageTitle, siteName, children }) => {
  const enabled = useMemo(() => votingFlagEnabled(), []);
  const initial = useMemo(readPersisted, []);
  const [mode, setMode] = useState<VoteMode>(initial.mode);
  const [voter, setVoter] = useState(initial.voter);
  const [votes, setVotes] = useState<VoteMap>(initial.votes);
  const [panelOpen, setPanelOpen] = useState(initial.panelOpen);
  const [pageTitles, setPageTitles] = useState<Record<string, string>>({
    ...initial.pageTitles,
    [pageId]: pageTitle,
  });
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [sectionTitles, setSectionTitles] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, voter, votes, panelOpen, pageTitles }));
    } catch {
      /* private mode */
    }
  }, [enabled, mode, voter, votes, panelOpen, pageTitles]);

  // Remember section titles per page so the export names sections even for
  // pages visited earlier in the session.
  useEffect(() => {
    if (sections.length === 0) return;
    setSectionTitles((prev) => ({
      ...prev,
      [pageId]: Object.fromEntries(sections.map((s) => [s.id, s.title])),
    }));
  }, [sections, pageId]);

  const castVote = useCallback(
    (sectionId: string, choice: Choice) => {
      setVotes((v) => {
        const page = { ...(v[pageId] ?? {}) };
        const entry = { ...(page[sectionId] ?? {}) };
        entry.choice = entry.choice === choice ? undefined : choice; // click again to unvote
        page[sectionId] = entry;
        return { ...v, [pageId]: page };
      });
    },
    [pageId]
  );

  const setComment = useCallback(
    (sectionId: string, comment: string) => {
      setVotes((v) => {
        const page = { ...(v[pageId] ?? {}) };
        page[sectionId] = { ...(page[sectionId] ?? {}), comment };
        return { ...v, [pageId]: page };
      });
    },
    [pageId]
  );

  const clearVotes = useCallback(() => setVotes({}), []);

  const addBallots = useCallback(async (files: FileList | File[]) => {
    let added = 0;
    let rejected = 0;
    const next: Ballot[] = [];
    for (const file of Array.from(files)) {
      try {
        const parsed = JSON.parse(await file.text());
        if (isBallot(parsed)) {
          next.push(parsed);
          added += 1;
        } else {
          rejected += 1;
        }
      } catch {
        rejected += 1;
      }
    }
    setBallots((prev) => {
      const seen = new Set(prev.map((b) => `${b.voter}|${b.exportedAt}`));
      return [...prev, ...next.filter((b) => !seen.has(`${b.voter}|${b.exportedAt}`))];
    });
    return { added, rejected };
  }, []);

  const removeBallot = useCallback((index: number) => {
    setBallots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearBallots = useCallback(() => setBallots([]), []);

  const download = useCallback(() => {
    const ballot: Ballot = {
      format: 'vote-overlay/1',
      site: siteName,
      voter: voter.trim() || 'anonymous',
      exportedAt: new Date().toISOString(),
      pages: {},
    };
    for (const [pid, sectionsMap] of Object.entries(votes)) {
      const titled = sectionTitles[pid] ?? {};
      const out: Ballot['pages'][string]['sections'] = {};
      for (const [sid, entry] of Object.entries(sectionsMap)) {
        if (!entry.choice && !entry.comment?.trim()) continue;
        out[sid] = { title: titled[sid] ?? sid, choice: entry.choice, comment: entry.comment?.trim() || undefined };
      }
      if (Object.keys(out).length > 0) {
        ballot.pages[pid] = { title: pageTitles[pid] ?? pid, sections: out };
      }
    }
    const blob = new Blob([JSON.stringify(ballot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const who = (voter.trim() || 'anonymous').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    a.download = `${siteName}-votes-${who}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [votes, voter, siteName, pageTitles, sectionTitles]);

  const votedCount = useMemo(
    () => sections.filter((s) => votes[pageId]?.[s.id]?.choice).length,
    [sections, votes, pageId]
  );

  const value = useMemo<VoteContextValue>(
    () => ({
      enabled,
      pageId,
      pageTitle,
      mode: enabled ? mode : 'off',
      setMode,
      voter,
      setVoter,
      votes,
      castVote,
      setComment,
      clearVotes,
      sections,
      setSections,
      ballots,
      addBallots,
      removeBallot,
      clearBallots,
      panelOpen,
      setPanelOpen,
      download,
      votedCount,
    }),
    [enabled, pageId, pageTitle, mode, voter, votes, castVote, setComment, clearVotes, sections, ballots, addBallots, removeBallot, clearBallots, panelOpen, download, votedCount]
  );

  return <VoteContext.Provider value={value}>{children}</VoteContext.Provider>;
};

export function useVote(): VoteContextValue {
  const ctx = useContext(VoteContext);
  if (!ctx) {
    throw new Error('useVote must be used inside <VoteProvider>');
  }
  return ctx;
}

/** Safe variant for components that may render outside the provider. */
export function useVoteOptional(): VoteContextValue | null {
  return useContext(VoteContext);
}
