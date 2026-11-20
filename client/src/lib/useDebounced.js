import { useEffect, useState } from 'react';

/**
 * Wait until the user stops typing before using a value (saves a request per keystroke).
 * Compares by content, so passing a fresh object each render doesn't restart the timer forever.
 */
export function useDebounced(value, delay = 350) {
  const key = JSON.stringify(value);
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(JSON.parse(key)), delay);
    return () => clearTimeout(timer);
  }, [key, delay]);
  return debounced;
}
