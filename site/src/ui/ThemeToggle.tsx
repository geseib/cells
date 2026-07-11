import React, { useState } from 'react';
import Icon from './icons';

/**
 * Manual light/dark override for presenters: cycles system → dark → light →
 * system. The choice is stored under the `cells-theme` localStorage key
 * ('dark' | 'light'; absent = follow the OS) and applied as a data-theme
 * attribute on <html>, which styles.css maps to the token blocks. The HTML
 * entry points re-apply the stored value in an inline <head> script so a
 * forced theme never flashes the OS theme on load.
 */

type Forced = 'dark' | 'light' | null; // null = system

const STORAGE_KEY = 'cells-theme';

const readStored = (): Forced => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
};

const applyTheme = (theme: Forced) => {
  if (theme) {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  try {
    if (theme) {
      localStorage.setItem(STORAGE_KEY, theme);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable (private mode): the attribute still applies */
  }
};

const NEXT: Record<'system' | 'dark' | 'light', Forced> = {
  system: 'dark',
  dark: 'light',
  light: null,
};

const NEXT_LABEL: Record<'system' | 'dark' | 'light', string> = {
  system: 'Switch to dark theme',
  dark: 'Switch to light theme',
  light: 'Switch to system theme',
};

const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [theme, setTheme] = useState<Forced>(readStored);
  const state = theme ?? 'system';

  const cycle = () => {
    const next = NEXT[state];
    applyTheme(next);
    setTheme(next);
  };

  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : 'theme-toggle'}
      onClick={cycle}
      aria-label={NEXT_LABEL[state]}
      title={NEXT_LABEL[state]}
    >
      <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
      {theme === null && <span className="theme-auto">auto</span>}
    </button>
  );
};

export default ThemeToggle;
