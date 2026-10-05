import { describe, expect, it } from 'vitest';
import { ago, clock } from './time';

const at = (d: string) => new Date(d).getTime();
const now = at('2026-10-05T16:30:00');

describe('ago', () => {
  it('counts minutes, then hours, then days', () => {
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 3 * 60_000, now)).toBe('3 min ago');
    expect(ago(at('2026-10-05T13:10:00'), now)).toBe('3 h ago');
    expect(ago(at('2026-10-04T23:50:00'), now)).toBe('yesterday');
    expect(ago(at('2026-10-02T09:00:00'), now)).toBe('2 Oct');
    expect(ago(at('2025-12-31T09:00:00'), now)).toBe('31 Dec 2025');
  });

  it('formats a clock time', () => {
    expect(clock(at('2026-10-05T09:05:00'))).toBe('9:05');
  });
});
