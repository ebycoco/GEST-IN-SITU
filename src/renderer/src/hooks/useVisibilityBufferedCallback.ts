import { useEffect, useRef } from 'react';

/**
 * Hook React personnalisé qui enveloppe un callback de progression ou de mise à jour d'état.
 * Si la fenêtre est réduite ou masquée (document.visibilityState === 'hidden'), les appels au
 * callback sont bufferisés. Dès que l'application redevient visible, le callback est exécuté
 * une unique fois avec la dernière valeur reçue.
 */
export function useVisibilityBufferedCallback<T>(callback: (value: T) => void) {
  const callbackRef = useRef(callback);
  const bufferRef = useRef<T | null>(null);
  const hasPendingUpdateRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasPendingUpdateRef.current) {
        if (bufferRef.current !== null) {
          callbackRef.current(bufferRef.current);
        }
        bufferRef.current = null;
        hasPendingUpdateRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return (value: T) => {
    if (document.visibilityState === 'hidden') {
      bufferRef.current = value;
      hasPendingUpdateRef.current = true;
    } else {
      callbackRef.current(value);
    }
  };
}
