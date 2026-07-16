import { useCallback } from 'react';
import { confirmService } from '../components/confirmService';

export function useCloudActionGuard() {
  const guard = useCallback(async <T>(action: () => Promise<T> | T): Promise<T | undefined> => {
    if (!navigator.onLine) {
      await confirmService.confirm({
        title: "Connexion Internet Requise",
        message: "Cette action nécessite une connexion internet active pour communiquer avec le Cloud. Veuillez vérifier votre réseau.",
        isDanger: true,
        isAlert: true
      });
      return undefined;
    }
    return action();
  }, []);

  return guard;
}
