import React, { useState, useEffect, useRef } from 'react';
import Icon from './icons';
import CellDemo from './components/CellDemo';
import FailoverDemo from './components/FailoverDemo';

/** Slim sticky banner above the header: brand on the left, a dropdown menu of
    demo destinations on the right. Closes on outside click and Escape. */
const DemoBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const introUrl = process.env.INTRO_URL || '';

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="demo-banner">
      <span className="banner-brand">
        <span className="banner-dot" aria-hidden="true" /> Cell Demo
      </span>
      <div className="banner-menu" ref={menuRef}>
        <button
          className="banner-menu-btn"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="menu" size={15} /> Menu
        </button>
        {open && (
          <div className="banner-dropdown" role="menu">
            {introUrl && (
              <a role="menuitem" href={introUrl} target="_blank" rel="noopener noreferrer">
                Interactive guide
              </a>
            )}
            {introUrl && (
              <a role="menuitem" href={`${introUrl}/primer.html`} target="_blank" rel="noopener noreferrer">
                Primer
              </a>
            )}
            {introUrl && (
              <a role="menuitem" href={`${introUrl}/slides.html`} target="_blank" rel="noopener noreferrer">
                Slides
              </a>
            )}
            <a role="menuitem" href="/router.html">Router page</a>
            <a role="menuitem" href="/auto.html">Auto-router</a>
            <a role="menuitem" href="/demo-script.html">Demo walkthrough</a>
          </div>
        )}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'celldemo' | 'failoverdemo'>('celldemo');
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    // ADMIN_API_URL is injected at build time by webpack DefinePlugin;
    // deploy-frontend.sh reads it from the routing stack's outputs.
    const baseUrl = window.location.hostname === 'localhost'
      ? 'http://localhost:3000/prod'
      : (process.env.ADMIN_API_URL || '');
    setApiUrl(baseUrl);
  }, []);

  return (
    <div className="admin-container">
      <DemoBanner />
      <header className="admin-header">
        <div className="brand">
          Cell Architecture
          <span className="sub">Admin dashboard</span>
        </div>
        <nav className="tab-nav" aria-label="Dashboard tabs">
          <button
            className={activeTab === 'celldemo' ? 'selected' : ''}
            onClick={() => setActiveTab('celldemo')}
          >
            Cell demo
          </button>
          <button
            className={activeTab === 'failoverdemo' ? 'selected' : ''}
            onClick={() => setActiveTab('failoverdemo')}
          >
            Failover demo
          </button>
        </nav>
      </header>

      <div className="admin-content">
        {activeTab === 'celldemo' && <CellDemo apiUrl={apiUrl} />}
        {activeTab === 'failoverdemo' && <FailoverDemo apiUrl={apiUrl} />}

        {/* Navigation links — always visible */}
        <section className="section">
          <div className="kicker">Navigation</div>
          <h2>Explore the demo</h2>
          <div className="nav-grid">
            <a href="/router.html" className="nav-btn">Router page</a>
            <a href="/auto.html" className="nav-btn">Auto router</a>
            {/* Per-cell direct links are listed in the Cell Demo tab, sourced from the API */}
            {process.env.INTRO_URL && (
              <a
                href={process.env.INTRO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-btn primary"
              >
                <Icon name="book-open" size={15} /> Learn: How Cells Work
              </a>
            )}
            <a href="/demo-script.html" className="nav-btn">Demo walkthrough</a>
          </div>
        </section>
      </div>
    </div>
  );
};

export default App;
