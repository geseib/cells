import React from 'react';
import { createRoot } from 'react-dom/client';
import OperationsApp from './operations/OperationsApp';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <OperationsApp />
    </React.StrictMode>
  );
}
