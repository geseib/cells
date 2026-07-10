import React from 'react';
import { createRoot } from 'react-dom/client';
import 'reveal.js/reveal.css';
import './styles.css';
import './slides/deck.css';
import DeckApp from './slides/DeckApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<DeckApp />);
}
