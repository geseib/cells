import React from 'react';
import { createRoot } from 'react-dom/client';
import PrimerApp from './primer/PrimerApp';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <PrimerApp />
    </React.StrictMode>
  );
}
