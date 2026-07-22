import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import Icon from './ui/icons';
import RingMark from './ui/RingMark';
import ThemeToggle from './ui/ThemeToggle';
import { Flags, readFlags, writeFlags } from './vote/flags';

/**
 * The hidden /flags page — nothing links here. Flip feature flags for this
 * browser; they persist in localStorage. Flags can also be set from any page
 * via URL parameter, e.g. ?vote=on.
 */
const FLAG_META: Array<{ key: keyof Flags; name: string; description: string; param: string }> = [
  {
    key: 'voting',
    name: 'Section voting overlay',
    description:
      'Adds a Voting toggle to the top menu of the guide. Reviewers vote agree / disagree / unsure on every section, leave comments, and download their ballot as JSON; flip the dock to Results to load everyone’s files and see the tallies inline and in a summary panel.',
    param: 'vote=on',
  },
];

const FlagsApp: React.FC = () => {
  const [flags, setFlags] = useState<Flags>(readFlags());

  const toggle = (key: keyof Flags) => {
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    writeFlags(next);
  };

  return (
    <>
      <nav className="top-nav" aria-label="Flags">
        <span className="brand"><RingMark size={18} band={5} vnodes={4} /> Cells</span>
        <a href="./index.html">Guide</a>
        <a href="./primer.html">Primer</a>
        <a href="./slides.html">Slides</a>
        <a href="./operations.html">Operations</a>
        <span style={{ flex: 1 }} />
        <ThemeToggle />
      </nav>
      <header className="hero">
        <h1>Feature flags</h1>
        <p className="lede">
          Per-browser switches, stored locally. Nothing links to this page — flags can also be
          set from any page with a URL parameter.
        </p>
      </header>
      <main>
        <section className="lesson" id="flags">
          {FLAG_META.map((f) => (
            <div key={f.key} className="panel flag-row">
              <div className="flag-info">
                <div className="flag-name">
                  <Icon name="flag" size={15} /> {f.name}
                </div>
                <p className="flag-desc">{f.description}</p>
                <p className="flag-desc">
                  URL override: <code>?{f.param}</code> (or <code>?{f.param.replace('on', 'off')}</code>)
                </p>
              </div>
              <button
                type="button"
                className={`flag-switch${flags[f.key] ? ' on' : ''}`}
                role="switch"
                aria-checked={flags[f.key]}
                aria-label={`${f.name}: ${flags[f.key] ? 'enabled' : 'disabled'}`}
                onClick={() => toggle(f.key)}
              >
                <span className="flag-knob" />
                <span className="flag-state">{flags[f.key] ? 'On' : 'Off'}</span>
              </button>
            </div>
          ))}
        </section>
      </main>
    </>
  );
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<FlagsApp />);
}
