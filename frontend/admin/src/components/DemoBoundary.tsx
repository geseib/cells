import React from 'react';

// A render crash in a demo tab must degrade to an error panel, not unmount
// the whole dashboard mid-presentation (these tabs talk to live AWS state,
// so an unexpected payload shape is survivable, a black screen is not).
// Generic sibling of FailoverDemo's own boundary — wrap NEW tabs in this.
interface DemoBoundaryProps {
  kicker: string;
  title: string;
  children: React.ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class DemoBoundary extends React.Component<DemoBoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <section className="section" data-testid="demo-boundary-panel">
          <div className="kicker">{this.props.kicker}</div>
          <h2>{this.props.title}</h2>
          <div className="panel">
            <p className="error-note">
              This panel hit a rendering error: {this.state.error.message}
            </p>
            <p style={{ color: 'var(--ink-2)', fontSize: '0.9rem' }}>
              Any armed or deployed AWS resources are still real — use the button below to
              reload the panel, or drive the demo from the API directly if it persists.
            </p>
            <button className="primary" onClick={() => this.setState({ error: null })}>
              Reload panel
            </button>
          </div>
        </section>
      );
    }
    return <>{this.props.children}</>;
  }
}

export default DemoBoundary;
