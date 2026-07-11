import React from 'react';

/**
 * Thin stroke-line icon set: 24×24 viewBox, 1.75px strokes, round caps,
 * currentColor — drawn to match the site's diagram language (arcs, dashes,
 * thin rules). This is the canonical copy; frontend/admin and frontend/spa
 * carry duplicates because the three apps are separate npm packages.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  bolt: <path d="M13 2 4.5 13.5H11L10 22l9.5-11.5H13L13 2z" />,
  play: <path d="M8 5.5 18.5 12 8 18.5V5.5z" />,
  pause: <path d="M9.5 6v12M14.5 6v12" />,
  'cloud-bolt': (
    <>
      <path d="M18.4 15.5A4 4 0 0 0 18 8a6 6 0 0 0-11.2-1.6A5 5 0 0 0 5.4 16" />
      <path d="M12.5 11 10 15h4l-2.5 4" />
    </>
  ),
  skull: (
    <>
      <path d="M12 4.5a7.5 7.5 0 0 0-4.5 13.5v2a1.8 1.8 0 0 0 1.8 1.8h5.4a1.8 1.8 0 0 0 1.8-1.8v-2A7.5 7.5 0 0 0 12 4.5Z" />
      <circle cx="9.3" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M12 15v1.5" />
    </>
  ),
  check: <path d="M5 13.5 10 18.5 19 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16.5 9" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.2" r="0.5" fill="currentColor" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
      <path d="M4.5 5.5v6.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5.5" />
      <path d="M4.5 12v6.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V12" />
    </>
  ),
  maximize: <path d="M16 3h5v5M8 21H3v-5M21 3l-7 7M3 21l7-7" />,
  shuffle: (
    <path d="M3 7h4l10 10h4m0 0-2.5-2.5M21 17l-2.5 2.5M3 17h4l2.5-2.5M13.5 9.5 17 7h4m0 0-2.5-2.5M21 7l-2.5 2.5" />
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 13.8 13.8 8.5 15.5l1.7-5.3 5.3-1.7Z" />
    </>
  ),
  waves: (
    <path d="M2 8c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 15c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
  ),
  'book-open': (
    <path d="M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2V5ZM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7V5Z" />
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1L20.5 8" />
      <path d="M20.5 3.5V8H16" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18Z" />
    </>
  ),
  dice: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <circle cx="8.5" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 21.5s7-6.3 7-11.3a7 7 0 0 0-14 0c0 5 7 11.3 7 11.3Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  'bar-chart': <path d="M5 20V10M12 20V4M19 20v-7" />,
  'heart-pulse': (
    <>
      <path d="M12 20S3.5 14.7 2.9 9.9A4.9 4.9 0 0 1 12 7a4.9 4.9 0 0 1 9.1 2.9C20.5 14.7 12 20 12 20Z" />
      <path d="M7 11.5h2.4l1.2-2 2.2 4 1.2-2H16.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 6.6M21 20a6 6 0 0 0-4.2-5.7" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4.4l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4l-1.3 1.3" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4-.4L5 12.2a4.5 4.5 0 0 0 6.4 6.4l1.3-1.3" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 4.5v5M5 14v5.5M12 4.5V7M12 11.5v8M19 4.5V13M19 17.5v2" />
      <circle cx="5" cy="11.7" r="1.9" />
      <circle cx="12" cy="9.2" r="1.9" />
      <circle cx="19" cy="15.2" r="1.9" />
    </>
  ),
  'arrow-right-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8m0 0-3-3m3 3-3 3" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </>
  ),
  moon: <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export const Icon: React.FC<{
  name: keyof typeof GLYPHS & string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}> = ({ name, size = 15, strokeWidth = 1.75, className }) => (
  <svg
    className={className ? `icon ${className}` : 'icon'}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {GLYPHS[name]}
  </svg>
);

export default Icon;
