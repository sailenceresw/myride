import { useEffect, useState } from 'react';

/** The current time, refreshed every `ms` — for "Drop-off 4:32 PM" style labels that should stay correct. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
