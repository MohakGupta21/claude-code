import { useCallback, useRef, useState } from 'react';

export type ToastTone = 'info' | 'error' | 'success';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

const TOAST_MS = 3200;
const MAX_TOASTS = 4;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (text: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-(MAX_TOASTS - 1)), { id, text, tone }]);
      window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}
