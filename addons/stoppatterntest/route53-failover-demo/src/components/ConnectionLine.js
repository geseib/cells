import React from 'react';

function ConnectionLine({ isPrimary }) {
  return (
    <div style={{ margin: '1rem', fontSize: '1.5rem' }}>
      <p>Connection: {isPrimary ? '••• Primary (1.1.1.1)' : '••• Secondary (2.2.2.2)'}</p>
    </div>
  );
}

export default ConnectionLine;
