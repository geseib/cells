import React, { useState, useEffect } from 'react';
import CellDemo from './components/CellDemo';
import FailoverDemo from './components/FailoverDemo';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'celldemo' | 'failoverdemo'>('celldemo');
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    const baseUrl = window.location.hostname === 'localhost' 
      ? 'http://localhost:3000/prod' 
      : 'https://lo4603bdh4.execute-api.us-east-1.amazonaws.com/prod';
    setApiUrl(baseUrl);
  }, []);

  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>Cell Architecture Admin Dashboard</h1>
        
        {/* Tab Navigation */}
        <div style={{ 
          marginTop: '1rem',
          display: 'flex',
          gap: '0.5rem'
        }}>
          <button
            onClick={() => setActiveTab('celldemo')}
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              fontWeight: '600',
              border: 'none',
              borderRadius: '0.25rem 0.25rem 0 0',
              cursor: 'pointer',
              background: activeTab === 'celldemo' 
                ? 'linear-gradient(135deg, #5e72e4 0%, #8965e0 100%)' 
                : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              transition: 'all 0.15s ease',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'celldemo') {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'celldemo') {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }
            }}
          >
            🏗️ Cell Demo
          </button>
          
          <button
            onClick={() => setActiveTab('failoverdemo')}
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              fontWeight: '600',
              border: 'none',
              borderRadius: '0.25rem 0.25rem 0 0',
              cursor: 'pointer',
              background: activeTab === 'failoverdemo' 
                ? 'linear-gradient(135deg, #5e72e4 0%, #8965e0 100%)' 
                : 'rgba(255, 255, 255, 0.1)',
              color: '#ffffff',
              transition: 'all 0.15s ease',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
            onMouseEnter={(e) => {
              if (activeTab !== 'failoverdemo') {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== 'failoverdemo') {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }
            }}
          >
            🔄 Failover Demo
          </button>
        </div>
      </header>

      <div className="admin-content">
        {/* Tab Content */}
        {activeTab === 'celldemo' && <CellDemo apiUrl={apiUrl} />}
        {activeTab === 'failoverdemo' && <FailoverDemo apiUrl={apiUrl} />}

        {/* Navigation Links - Always visible */}
        <section className="section">
          <h2>🔗 Navigation</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '1rem'
          }}>
            <a 
              href="/router.html" 
              className="nav-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '10px',
                fontWeight: '500',
                transition: 'transform 0.2s ease',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              🔀 Router Page
            </a>
            
            <a 
              href="/auto.html" 
              className="nav-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '10px',
                fontWeight: '500',
                transition: 'transform 0.2s ease',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              🚀 Auto Router
            </a>
            
            <a 
              href="https://cell-us-east-1-az1.sb.seibtribe.us" 
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '10px',
                fontWeight: '500',
                transition: 'transform 0.2s ease',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              🌌 Cell us-east-1-az1
            </a>
            
            <a 
              href="https://cell-us-east-1-az2.sb.seibtribe.us" 
              target="_blank"
              rel="noopener noreferrer"
              className="nav-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '10px',
                fontWeight: '500',
                transition: 'transform 0.2s ease',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              🌅 Cell us-east-1-az2
            </a>
            
            <a 
              href="/demo-script.html" 
              className="nav-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1rem',
                background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '10px',
                fontWeight: '500',
                transition: 'transform 0.2s ease',
                textAlign: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              📋 Demo Walkthrough
            </a>
          </div>
        </section>
      </div>
    </div>
  );
};

export default App;