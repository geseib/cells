import React, { useState, useEffect } from 'react';
import CellDemo from './components/CellDemo';
import FailoverDemo from './components/FailoverDemo';

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
                📖 Learn: How Cells Work
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
