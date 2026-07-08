import React from 'react';

const DEMO_ADMIN_URL = process.env.DEMO_ADMIN_URL || '';

/**
 * Contextual link from a lesson to the corresponding page of a live AWS demo
 * deployment. Renders nothing when the site is built without DEMO_ADMIN_URL
 * (e.g. the generic Vercel/GitHub Pages build).
 */
const TryLive: React.FC<{ path?: string; children: React.ReactNode }> = ({ path = '', children }) => {
  if (!DEMO_ADMIN_URL) return null;
  return (
    <p className="try-live">
      <a href={`${DEMO_ADMIN_URL}${path}`} target="_blank" rel="noopener noreferrer">
        {children} ↗
      </a>
    </p>
  );
};

export const hasLiveDemo = Boolean(DEMO_ADMIN_URL);
export const demoAdminUrl = DEMO_ADMIN_URL;

export default TryLive;
