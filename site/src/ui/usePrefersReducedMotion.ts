import { useEffect, useState } from 'react';

/**
 * True when the user asked the OS for reduced motion — gates sim pacing and
 * the SMIL/JS animations. Single shared copy; BeyondCells re-exports it for
 * back-compat (WhyCells and ui/Sidequest import it from there), and the ops
 * sims' shared.tsx re-exports it likewise.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
