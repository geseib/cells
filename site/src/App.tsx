import React from 'react';
import { VoteProvider } from './vote/VoteContext';
import GuideHub from './guide/GuideHub';

const App: React.FC = () => (
  <VoteProvider
    pageId="guide"
    pageTitle="Cell-Based Architecture — Interactive Guide"
    siteName="cells"
  >
    <GuideHub />
  </VoteProvider>
);

export default App;
