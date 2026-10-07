// First-run tour (mockups/tour-a-coach.html): a spotlight on one real control at a time, with a bubble.
// Sections start on their own the first time their part of the app shows (engine/tour.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { markSeen, pickSection, placeBubble, type Rect, type TourSection } from '../engine/tour';
import { isSpeech } from '../engine/types';
import { useStore, type State } from '../state/store';
import { combo } from './keys';

/** `when`: the step is left out unless this is on screen (default: the target itself). */
type Step = { target: string | null; when?: string; title: string; body: ReactNode };

const STEPS: Record<TourSection, Step[]> = {
  welcome: [
    {
      target: null,
      title: 'Welcome to Yarnit',
      body: 'Edit audio by editing its transcript: cut a word and it is cut from the sound. This short tour shows you around, and picks up again as you go.',
    },
    {
      target: '.empty .drop > button.primary',
      title: 'Add your recordings',
      body: "Drop MP3, WAV or M4A files on the page, or choose them here. Yarnit asks what each one is: interviews and voice-overs get a transcript, music and sound effects don't. Nothing is uploaded.",
    },
    {
      target: '.empty .settings',
      title: 'Pick a speech model',
      body: 'Balanced suits most English recordings; use Multilingual for other languages. It downloads once, the first time you transcribe, and then stays in your browser.',
    },
    {
      target: '.help-toggle',
      title: 'Help is always here',
      body: (
        <>
          Shortcuts, tips and answers to common questions. Press <kbd>?</kbd> to open it. You can take this tour again from there.
        </>
      ),
    },
    { target: '.empty .drop > button.primary', title: 'Now add a recording', body: 'Choose a file or drop one on the page. The tour carries on when its transcript is ready.' },
  ],
  speech: [
    {
      target: 'aside.side',
      title: 'Your recordings',
      body: 'Every recording in the project is listed here and edited on its own. Use ⋯ to rename one or change what it is. The main timeline at the top is where the final version comes together.',
    },
    {
      target: 'section.timeline',
      title: 'Play and the waveform',
      body: (
        <>
          Press <kbd>Space</kbd> to play. Click the waveform to jump there, or drag across it to select audio, then cut it or keep it as a part.
        </>
      ),
    },
    {
      target: 'main.doc',
      title: 'Edit the text, the audio follows',
      body: (
        <>
          Drag across words, or <kbd>Shift</kbd>+click, to select them, then press <kbd>Delete</kbd>: they are cut from the audio too. Cut words stay visible, crossed out,
          and <kbd>{combo('mod', 'Z')}</kbd> brings anything back.
        </>
      ),
    },
    {
      target: '.highlights-toggle',
      title: 'Mark what matters',
      body: (
        <>
          Select words and press <kbd>1</kbd> to <kbd>6</kbd> to highlight them in a colour. Highlights lists every marked passage, so the good bits are easy to find again.
        </>
      ),
    },
    {
      target: '.send-toggle',
      title: 'Send to main',
      body: 'Copies this recording to the main timeline: the whole edit, the selected words, a highlight colour or a part. Later edits here do not change what you sent.',
    },
    {
      target: '.side .main-item',
      title: 'Then open the main timeline',
      body: 'Arrange what you sent there, with voice, music and effects on their own lanes. The tour shows you around the first time it has clips.',
    },
  ],
  music: [
    {
      target: 'section.timeline',
      title: 'Mark the parts you want',
      body: (
        <>
          Music and sound effects are not cut. Drag across the waveform and click <b>Add as part</b> (or press <kbd>Enter</kbd>) to keep a piece, such as an intro, a bed or
          a sting.
        </>
      ),
    },
    {
      target: '.doc .parts',
      title: 'Your parts',
      body: 'Play, rename or delete each part here, and drag its edges on the waveform to adjust it. Send to main sends one part; Send all to main sends every part at once.',
    },
  ],
  main: [
    {
      target: 'section.main-timeline',
      title: 'One lane per kind',
      body: 'Interviews and voice-overs play one after another, in running order. Music and effects play underneath: drag them to where they should start. Dragged clips snap to the edges of the others, shown by a yellow line.',
    },
    {
      target: '.mclip',
      title: 'Click a clip',
      body: 'Click a spot to cut the clip in two there. Below the lanes, set its volume (for example 30% for music under a voice), a fade in and out, or the pause before it.',
    },
    {
      target: 'main.doc',
      when: '.cliphead',
      title: 'Cut words here too',
      body: 'The transcript of every voice clip, in running order. Cutting words here changes only that clip, not the recording. The arrows change the order.',
    },
    {
      target: '.top .menu > button.primary',
      title: 'Export the mix',
      body: 'Mixes every lane into one MP3 or WAV file. Undo and Redo work on the main timeline while it is open.',
    },
  ],
};

const section = (s: State) =>
  pickSection(
    {
      busy: !s.booted || !!s.pendingFiles || s.panel != null || s.phase === 'decoding' || s.phase === 'exporting',
      recording: s.recording ? { speech: isSpeech(s.recording.kind), hasWords: s.transcribed && s.recording.words.length > 0 } : null,
      mainOpen: s.mainOpen,
      mainClips: s.project?.main?.clips.length ?? 0,
    },
    s.settings.tour,
  );

const PAD = 6;

export function Tour() {
  const next = useStore(section);
  const [active, setActive] = useState<{ section: TourSection; steps: Step[]; i: number } | null>(null);

  // start a little after the screen settles, and only with the targets that are actually there
  useEffect(() => {
    if (active || !next) return;
    const t = setTimeout(() => {
      const steps = STEPS[next].filter((s) => !(s.when ?? s.target) || document.querySelector((s.when ?? s.target)!));
      if (steps.length) setActive({ section: next, steps, i: 0 });
    }, 700);
    return () => clearTimeout(t);
  }, [active, next]);

  if (!active) return null;
  const end = (off: boolean) => {
    const { settings, setSettings } = useStore.getState();
    const tour = markSeen(settings.tour, active.section);
    setSettings({ tour: off ? { ...tour, off: true } : tour });
    setActive(null);
  };
  const go = (d: number) => {
    const i = active.i + d;
    if (i >= active.steps.length) end(false);
    else if (i >= 0) setActive({ ...active, i });
  };
  return <Bubble key={`${active.section}${active.i}`} step={active.steps[active.i]} i={active.i} n={active.steps.length} welcome={active.section === 'welcome'} go={go} end={end} />;
}

function Bubble({ step, i, n, welcome, go, end }: { step: Step; i: number; n: number; welcome: boolean; go: (d: number) => void; end: (off: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [size, setSize] = useState({ width: 340, height: 160 });
  const [view, setView] = useState(viewport);

  // follow the target: it can move as the app lays out, scrolls or resizes
  useEffect(() => {
    const el = step.target ? document.querySelector(step.target) : null;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let frame = 0;
    const tick = () => {
      const r = step.target ? document.querySelector(step.target)?.getBoundingClientRect() : null;
      const v = viewport();
      // keep the spotlight on screen when the target is taller than the window
      const next = r && r.width > 0 ? clip({ left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }, v) : null;
      setRect((old) => (same(old, next) ? old : next));
      setView((old) => (old.width === v.width && old.height === v.height ? old : v));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step.target]);

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setSize((old) => (old.width === el.offsetWidth && old.height === el.offsetHeight ? old : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // keys go to the tour first, so Esc or an arrow does not also act on the app behind it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k !== 'Escape' && k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Enter') return;
      if (k === 'Enter' && (e.target as Element).closest?.('button')) return; // the button clicks itself
      e.preventDefault();
      e.stopPropagation();
      if (k === 'Escape') end(true);
      else go(k === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, end]);

  const place = useMemo(() => placeBubble(rect, size, view), [rect, size, view]);
  const last = i === n - 1;
  const first = welcome && i === 0;
  // the arrow points at the middle of the target, kept on the bubble's edge
  const arrow =
    rect && (place.side === 'below' || place.side === 'above')
      ? { left: Math.max(18, Math.min(size.width - 18, rect.left + rect.width / 2 - place.left)) }
      : rect && (place.side === 'right' || place.side === 'left')
        ? { top: Math.max(18, Math.min(size.height - 18, rect.top + rect.height / 2 - place.top)) }
        : null;

  return (
    <>
      {rect ? <div className="tour-spot" style={rect} aria-hidden /> : <div className="tour-dim" aria-hidden />}
      <div ref={ref} className="tour-tip" role="dialog" aria-label={step.title} style={{ left: place.left, top: place.top }}>
        {arrow && <span className={`tour-arrow ${place.side}`} style={arrow} />}
        <h5>{step.title}</h5>
        <p>{step.body}</p>
        <div className="tour-bar">
          {first ? (
            <>
              <span className="tour-count" />
              <button className="ghost" onClick={() => end(true)}>
                Skip, I'll explore
              </button>
              <button className="primary" onClick={() => go(1)}>
                Show me around
              </button>
            </>
          ) : (
            <>
              <span className="tour-count">
                {i + 1} of {n}
              </span>
              {!last && (
                <button className="ghost" onClick={() => end(true)} title="Turn the tour off (Esc). Help can start it again.">
                  Skip tour
                </button>
              )}
              {i > 0 && <button onClick={() => go(-1)}>Back</button>}
              <button className="primary" onClick={() => go(1)}>
                {last ? 'Done' : 'Next'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** The part of the page actually on screen (innerHeight grows when a page is wider than a phone). */
const viewport = () => ({ width: visualViewport?.width ?? innerWidth, height: visualViewport?.height ?? innerHeight });

const same = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

function clip(r: Rect, v: { width: number; height: number }): Rect {
  const left = Math.max(2, r.left);
  const top = Math.max(2, r.top);
  return { left, top, width: Math.min(v.width - 2, r.left + r.width) - left, height: Math.min(v.height - 2, r.top + r.height) - top };
}
