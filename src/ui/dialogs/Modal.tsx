import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconBtn } from '../controls';

export function Modal({ title, onClose, children, width = 460, footer, locked }: {
  title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode;
  /** Blocks Escape and backdrop dismissal while work is running. */
  locked?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !locked) onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, locked]);
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={{ width }}>
        <header className="modal-head"><b>{title}</b><span className="grow" />{!locked && <IconBtn icon="close" title="Close" onClick={onClose} />}</header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
