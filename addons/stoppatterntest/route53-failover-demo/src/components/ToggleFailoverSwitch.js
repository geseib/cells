import React from 'react';

function ToggleFailoverSwitch({ toggle, isPrimary }) {
  return (
    <button onClick={toggle} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
      Switch to {isPrimary ? 'Secondary' : 'Primary'}
    </button>
  );
}

export default ToggleFailoverSwitch;
