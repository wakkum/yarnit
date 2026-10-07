import { describe, expect, it } from 'vitest';
import { FRESH_TOUR, markSeen, pickSection, placeBubble, readTour, type TourContext } from './tour';

const ctx = (c: Partial<TourContext> = {}): TourContext => ({ busy: false, recording: null, mainOpen: false, mainClips: 0, ...c });

describe('pickSection', () => {
  it('welcomes on the start screen', () => {
    expect(pickSection(ctx(), FRESH_TOUR)).toBe('welcome');
  });

  it('waits for the transcript before the speech section', () => {
    expect(pickSection(ctx({ recording: { speech: true, hasWords: false } }), FRESH_TOUR)).toBeNull();
    expect(pickSection(ctx({ recording: { speech: true, hasWords: true } }), FRESH_TOUR)).toBe('speech');
  });

  it('shows the music section for music and effects', () => {
    expect(pickSection(ctx({ recording: { speech: false, hasWords: false } }), FRESH_TOUR)).toBe('music');
  });

  it('shows the main section only once it has clips', () => {
    expect(pickSection(ctx({ mainOpen: true }), FRESH_TOUR)).toBeNull();
    expect(pickSection(ctx({ mainOpen: true, mainClips: 2 }), FRESH_TOUR)).toBe('main');
  });

  it('never starts while busy, after Skip, or twice', () => {
    expect(pickSection(ctx({ busy: true }), FRESH_TOUR)).toBeNull();
    expect(pickSection(ctx(), { ...FRESH_TOUR, off: true })).toBeNull();
    expect(pickSection(ctx(), markSeen(FRESH_TOUR, 'welcome'))).toBeNull();
  });
});

describe('markSeen / readTour', () => {
  it('adds a section once', () => {
    const t = markSeen(markSeen(FRESH_TOUR, 'music'), 'music');
    expect(t.seen).toEqual(['music']);
    expect(markSeen(t, 'music')).toBe(t);
  });

  it('cleans saved values', () => {
    expect(readTour(undefined)).toEqual(FRESH_TOUR);
    expect(readTour({ off: 'yes', seen: ['main', 'bogus', 'welcome'] })).toEqual({ off: false, seen: ['welcome', 'main'] });
  });
});

describe('placeBubble', () => {
  const view = { width: 1000, height: 800 };
  const bubble = { width: 300, height: 150 };

  it('goes below a target near the top, centred and clamped', () => {
    expect(placeBubble({ left: 900, top: 10, width: 80, height: 30 }, bubble, view)).toEqual({ left: 684, top: 52, side: 'below' });
  });

  it('goes above a target near the bottom', () => {
    expect(placeBubble({ left: 100, top: 700, width: 100, height: 40 }, bubble, view)).toMatchObject({ top: 538, side: 'above' });
  });

  it('goes beside a tall target', () => {
    expect(placeBubble({ left: 0, top: 50, width: 240, height: 700 }, bubble, view)).toMatchObject({ left: 252, side: 'right' });
  });

  it('centres without a target, and over a full-screen one', () => {
    expect(placeBubble(null, bubble, view)).toEqual({ left: 350, top: 325, side: 'center' });
    expect(placeBubble({ left: 0, top: 0, width: 1000, height: 800 }, bubble, view)).toEqual({ left: 350, top: 634, side: 'center' });
  });
});
