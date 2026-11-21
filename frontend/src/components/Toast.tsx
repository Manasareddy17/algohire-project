import { useEffect } from 'react';

export interface ToastMessage {
  kind: 'ok' | 'error';
  text: string;
}

/** Small pop-up in the top-right corner. Disappears by itself after a few seconds. */
export function Toast({ message, onClose }: { message: ToastMessage | null; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, message.kind === 'ok' ? 3000 : 6000);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;
  return (
    <div className={`toast toast-${message.kind}`} role="status">
      <span>{message.kind === 'ok' ? '✔' : '✖'}</span>
      <p>{message.text}</p>
      <button className="toast-close" onClick={onClose} aria-label="Close">×</button>
    </div>
  );
}
