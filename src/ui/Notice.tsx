import { useEffect } from 'react';
import { useStore } from '../state/store';

const NOTICE_MS = 5000;

/** A message at the bottom of the window that goes away by itself. */
export function Notice() {
  const notice = useStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => useStore.getState().setNotice(''), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  return notice ? (
    <div className="notice" role="status" onClick={() => useStore.getState().setNotice('')}>
      {notice}
    </div>
  ) : null;
}
