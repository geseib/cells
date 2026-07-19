/**
 * Feature flags for the site. Flags live in localStorage and can be flipped
 * on the hidden /flags page, or via a URL parameter on any page:
 *   ?vote=on   (also #vote=on)  → enable the voting overlay
 *   ?vote=off  (also #vote=off) → disable it
 * No flag, no UI: every voting surface renders null when the flag is down.
 */

const STORAGE_KEY = 'cells-flags';

export interface Flags {
  voting: boolean;
}

const DEFAULTS: Flags = { voting: false };

export function readFlags(): Flags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeFlags(flags: Flags): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    /* private mode: flags just don't persist */
  }
}

/** Apply ?vote=on/off (or #vote=on/off) once at page load. */
export function applyUrlFlagOverrides(): void {
  try {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const v = q.get('vote') ?? h.get('vote');
    if (v === 'on' || v === '1') writeFlags({ ...readFlags(), voting: true });
    if (v === 'off' || v === '0') writeFlags({ ...readFlags(), voting: false });
  } catch {
    /* no-op */
  }
}

export function votingFlagEnabled(): boolean {
  applyUrlFlagOverrides();
  return readFlags().voting;
}
