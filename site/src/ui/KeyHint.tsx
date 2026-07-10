import React, { useEffect } from 'react';

/**
 * Presenter hotkeys for the slide deck. Components accept an optional
 * `hotkeys` prop; on the web pages it stays false and neither the kbd chips
 * nor the listeners exist. Keys are chosen to avoid everything reveal.js
 * binds (space, arrows, N/P, S, F, B, O, ESC, ?).
 */
export const KeyHint: React.FC<{ k: string }> = ({ k }) => (
  <kbd className="key-hint" aria-hidden="true">{k}</kbd>
);

export function useHotkeys(enabled: boolean, map: Record<string, () => void>): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const action = map[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled, map]);
}

export default KeyHint;
