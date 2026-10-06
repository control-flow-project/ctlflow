import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

export function Dialog({ title, description, busy = false, initialFocus, onCancel, children, footer }: {
  title: string; description: string; busy?: boolean; initialFocus?: RefObject<HTMLElement | null>; onCancel(): void; children: ReactNode; footer: ReactNode;
}) {
  const reference = useRef<HTMLDialogElement>(null), titleId = useId(), descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = reference.current!, focus = document.activeElement, overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    dialog.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog.close();
      document.documentElement.style.overflow = overflow;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [initialFocus]);
  return <dialog ref={reference} className="management-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="dialog-frame"><header className="dialog-heading"><div><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div>
      <button type="button" aria-label="Close dialog" disabled={busy} onClick={onCancel}>×</button></header>
      <div className="dialog-body">{children}</div><footer className="dialog-footer">{footer}</footer></div>
  </dialog>;
}
