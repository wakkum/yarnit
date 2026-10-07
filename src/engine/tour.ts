// First-run tour (mockups/tour-a-coach.html, picked 7 Oct 2026, without the demo project): short
// sections that each start the first time their part of the app is on screen.

export const TOUR_SECTIONS = ['welcome', 'speech', 'music', 'main'] as const;
export type TourSection = (typeof TOUR_SECTIONS)[number];

/** Saved per browser: `off` after Skip; `seen` sections never start again on their own. */
export type TourState = { off: boolean; seen: TourSection[] };
export const FRESH_TOUR: TourState = { off: false, seen: [] };

/** What is on screen right now, as far as the tour cares. */
export type TourContext = {
  /** A dialog, side panel or long task is in the way: wait. */
  busy: boolean;
  recording: null | { speech: boolean; hasWords: boolean };
  mainOpen: boolean;
  mainClips: number;
};

/** The section to start now, or null. */
export function pickSection(ctx: TourContext, tour: TourState): TourSection | null {
  if (tour.off || ctx.busy) return null;
  const want: TourSection | null = ctx.mainOpen
    ? ctx.mainClips > 0
      ? 'main'
      : null
    : !ctx.recording
      ? 'welcome'
      : ctx.recording.speech
        ? ctx.recording.hasWords
          ? 'speech'
          : null
        : 'music';
  return want && !tour.seen.includes(want) ? want : null;
}

export const markSeen = (tour: TourState, s: TourSection): TourState =>
  tour.seen.includes(s) ? tour : { ...tour, seen: [...tour.seen, s] };

/** Settings from older versions, or edited by hand, may hold anything. */
export function readTour(v: unknown): TourState {
  if (!v || typeof v !== 'object') return FRESH_TOUR;
  const o = v as Partial<TourState>;
  return {
    off: o.off === true,
    seen: Array.isArray(o.seen) ? TOUR_SECTIONS.filter((s) => o.seen!.includes(s)) : [],
  };
}

export type Rect = { left: number; top: number; width: number; height: number };
export type Placement = { left: number; top: number; side: 'below' | 'above' | 'right' | 'left' | 'center' };

/**
 * Where the bubble goes: below the target if it fits, else above, else beside it, else centred.
 * Always kept `gutter` px inside the viewport.
 */
export function placeBubble(target: Rect | null, bubble: { width: number; height: number }, view: { width: number; height: number }, gap = 12, gutter = 16): Placement {
  const clampX = (x: number) => Math.max(gutter, Math.min(view.width - bubble.width - gutter, x));
  const clampY = (y: number) => Math.max(gutter, Math.min(view.height - bubble.height - gutter, y));
  const center = { left: clampX((view.width - bubble.width) / 2), top: clampY((view.height - bubble.height) / 2), side: 'center' as const };
  if (!target) return center;
  const midX = target.left + target.width / 2 - bubble.width / 2;
  const midY = target.top + target.height / 2 - bubble.height / 2;
  const below = target.top + target.height + gap;
  if (below + bubble.height <= view.height - gutter) return { left: clampX(midX), top: below, side: 'below' };
  const above = target.top - gap - bubble.height;
  if (above >= gutter) return { left: clampX(midX), top: above, side: 'above' };
  const right = target.left + target.width + gap;
  if (right + bubble.width <= view.width - gutter) return { left: right, top: clampY(midY), side: 'right' };
  const left = target.left - gap - bubble.width;
  if (left >= gutter) return { left, top: clampY(midY), side: 'left' };
  // a target that fills the screen (the transcript on a phone): sit over its lower part
  return { left: center.left, top: clampY(view.height - bubble.height - gutter), side: 'center' };
}
