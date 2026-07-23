import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { SECTIONS, SECTION_INDEX, SectionDef, resolveHash } from './registry';
import MenuView from './MenuView';
import BottomNav from './BottomNav';
import RingMark from '../ui/RingMark';
import ThemeToggle from '../ui/ThemeToggle';
import NavVoteButton from '../vote/NavVoteButton';
import VoteOverlay from '../vote/VoteOverlay';
import { demoAdminUrl, hasLiveDemo } from '../TryLive';

/**
 * The guide hub: a menu view plus one-view-per-section, with location.hash
 * as the single source of truth. All navigation surfaces are plain anchors;
 * the ONE hashchange listener below resolves them through the registry —
 * back/forward, external deep links, and cross-section prose anchors all
 * work with zero caller changes.
 *
 * Sections lazy-mount on first visit (React.lazy → webpack code-splits) and
 * then stay MOUNTED BUT HIDDEN (hidden + inert + aria-hidden), so sim state
 * survives view switches.
 */

// React 18's @types lack the `inert` attribute; the string-attr idiom
// (inert="" to set, undefined to clear) works across React 18/19.
declare module 'react' {
  interface HTMLAttributes<T> {
    inert?: '' | undefined;
  }
}

const GUIDE_TITLE = 'Cell-Based Architecture — Interactive Guide';

/** Vote overlay registration: ALL ten sections, titled "{num}. {title}". */
const VOTE_SECTIONS = SECTIONS.map((s) => ({ id: s.id, title: `${s.num}. ${s.title}` }));

/** Fires onMounted after the lazy section actually resolves and mounts. */
const MountedSignal: React.FC<{ id: string; onMounted: (id: string) => void }> = ({ id, onMounted }) => {
  useEffect(() => {
    onMounted(id);
  }, [id, onMounted]);
  return null;
};

const SectionHost: React.FC<{
  section: SectionDef;
  active: boolean;
  onMounted: (id: string) => void;
}> = ({ section, active, onMounted }) => {
  const C = section.Component;
  return (
    <div
      className="view-host"
      data-view={section.id}
      hidden={!active}
      inert={active ? undefined : ''}
      aria-hidden={active ? undefined : true}
    >
      <span className="view-anchor" tabIndex={-1}>
        {section.num} · {section.title}
      </span>
      <Suspense fallback={<div className="view-loading" role="status">Loading {section.title}…</div>}>
        <C />
        <MountedSignal id={section.id} onMounted={onMounted} />
      </Suspense>
      <BottomNav current={section.id} />
    </div>
  );
};

interface NavState {
  view: string;
  scrollTo?: string;
  /** Bumped on every hashchange so repeat navigations re-run scroll/focus. */
  seq: number;
}

const GuideHub: React.FC = () => {
  const [nav, setNav] = useState<NavState>(() => ({
    ...resolveHash(window.location.hash),
    seq: 0,
  }));
  const [visited, setVisited] = useState<readonly string[]>(() => {
    const first = resolveHash(window.location.hash);
    return first.view !== 'menu' ? [first.view] : [];
  });
  const [mounted, setMounted] = useState<readonly string[]>([]);

  useEffect(() => {
    const onHash = () =>
      setNav((prev) => ({ ...resolveHash(window.location.hash), seq: prev.seq + 1 }));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // First visit lazy-mounts the view; after that it stays mounted-but-hidden.
  useEffect(() => {
    if (nav.view !== 'menu') {
      setVisited((v) => (v.includes(nav.view) ? v : [...v, nav.view]));
    }
  }, [nav.view]);

  const handleMounted = useCallback((id: string) => {
    setMounted((m) => (m.includes(id) ? m : [...m, id]));
  }, []);

  // Scroll + focus + title, once per navigation, deferred until the target
  // view's lazy component has actually mounted (so sub-anchor scrolls land).
  const handledSeq = useRef(-1);
  useEffect(() => {
    const def = nav.view === 'menu' ? undefined : SECTION_INDEX[nav.view];
    document.title = def ? `${def.num} · ${def.title} — Cell-Based Architecture` : GUIDE_TITLE;
    if (handledSeq.current >= nav.seq) return;
    if (def && !mounted.includes(def.id)) return; // wait for the lazy mount
    handledSeq.current = nav.seq;
    const inner = nav.scrollTo ? document.getElementById(nav.scrollTo) : null;
    if (inner) {
      inner.scrollIntoView();
    } else if (nav.seq > 0) {
      window.scrollTo(0, 0);
    }
    if (nav.seq > 0) {
      // Move focus to the active view's heading anchor for keyboard/SR users.
      document
        .querySelector<HTMLElement>(`.view-host[data-view="${def ? def.id : 'menu'}"] .view-anchor`)
        ?.focus({ preventScroll: true });
    }
  }, [nav, mounted]);

  const current = nav.view === 'menu' ? undefined : SECTION_INDEX[nav.view];

  return (
    <>
      <nav className="top-nav" aria-label="Guide">
        <a className="brand" href="#menu"><RingMark size={18} band={5} vnodes={4} /> Cells</a>
        <a href="#menu">Menu</a>
        {current && (
          <span className="nav-current" data-testid="nav-current">
            {current.num} · {current.title}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <a href="./primer.html" style={{ fontWeight: 600 }}>Primer</a>
        <a href="./slides.html" style={{ fontWeight: 600 }}>Slides</a>
        {hasLiveDemo && (
          <a href={demoAdminUrl} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
            Live demo ↗
          </a>
        )}
        <NavVoteButton />
        <ThemeToggle />
      </nav>
      {!current && (
        <header className="hero">
          <h1>Cell-Based Architecture</h1>
          <p className="lede">
            How AWS, Netflix, and Slack shrink outages from "everyone" to "a few percent":
            partition the workload into isolated cells and route every client to exactly one.
            Ten interactive lessons, all running in your browser — powered by the same
            consistent-hashing code this repository deploys to AWS. New to the problem itself?
            Start with the <a href="./primer.html">cloud-neutral primer</a>.
          </p>
          <RingMark className="hero-ring" size={240} band={4} vnodes={36} />
        </header>
      )}
      <main>
        <div
          className="view-host"
          data-view="menu"
          hidden={Boolean(current)}
          inert={current ? '' : undefined}
          aria-hidden={current ? true : undefined}
        >
          <MenuView />
        </div>
        {SECTIONS.filter((s) => visited.includes(s.id)).map((s) => (
          <SectionHost key={s.id} section={s} active={nav.view === s.id} onMounted={handleMounted} />
        ))}
      </main>
      <footer className="site-footer">
        Built as an educational companion to the{' '}
        <a href="https://github.com/geseib/cells" target="_blank" rel="noopener noreferrer">
          cells
        </a>{' '}
        repository · MIT licensed
      </footer>
      <VoteOverlay sections={VOTE_SECTIONS} mountedIds={mounted} />
    </>
  );
};

export default GuideHub;
