import { useEffect, useRef } from 'react';

/** Run `fn` now and every `ms` while `enabled`. `fn` is read from a ref, so the timer isn't recreated on every render. */
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => {
    if (!enabled) return;
    const run = () => { Promise.resolve(ref.current()).catch(() => {}); };
    run();
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}
