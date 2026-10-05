// "Saved 3 min ago" style labels for the Projects drawer and the reopen notice.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** How long ago `then` was, relative to `now` (both ms since epoch). */
export function ago(then: number, now: number): string {
  const s = Math.max(0, (now - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const a = new Date(then);
  const b = new Date(now);
  const days = Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000);
  if (days === 0) return `${Math.floor(s / 3600)} h ago`;
  if (days === 1) return 'yesterday';
  return `${a.getDate()} ${MONTHS[a.getMonth()]}${a.getFullYear() === b.getFullYear() ? '' : ` ${a.getFullYear()}`}`;
}

/** Clock time, e.g. "10:42", for "Saved 10:42". */
export const clock = (t: number) => {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
