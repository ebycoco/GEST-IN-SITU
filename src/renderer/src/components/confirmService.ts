type ConfirmResolver = (value: boolean) => void;

interface ConfirmOptions {
  title: string;
  message: string;
  isDanger?: boolean;
  requirePassword?: boolean;
  actionName?: string;
  isAlert?: boolean;
}

let activeConfirmResolver: ConfirmResolver | null = null;
let onShowConfirmCallback: ((options: ConfirmOptions) => void) | null = null;

export const confirmService = {
  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      activeConfirmResolver = resolve;
      if (onShowConfirmCallback) {
        onShowConfirmCallback(options);
      } else {
        // Fallback si non enregistré
        resolve(window.confirm(options.message));
      }
    });
  },
  
  resolve(value: boolean) {
    if (activeConfirmResolver) {
      activeConfirmResolver(value);
      activeConfirmResolver = null;
    }
  },

  register(callback: (options: ConfirmOptions) => void) {
    onShowConfirmCallback = callback;
  }
};
