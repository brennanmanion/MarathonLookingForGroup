import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastRecord {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (input: { kind?: ToastKind; message: string }) => void;
}

const TOAST_LIFETIME_MS = 4200;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismissToast = useCallback((toastId: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback((input: { kind?: ToastKind; message: string }) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const toast: ToastRecord = {
      id,
      kind: input.kind ?? 'info',
      message: input.message
    };

    setToasts((current) => [...current, toast]);
    window.setTimeout(() => {
      dismissToast(id);
    }, TOAST_LIFETIME_MS);
  }, [dismissToast]);

  const value = useMemo<ToastContextValue>(() => ({
    showToast
  }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <article className={`toast toast-${toast.kind}`} key={toast.id}>
            <p className="toast-message">{toast.message}</p>
            <button
              className="toast-close"
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </article>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside ToastProvider');
  }

  return context;
}
