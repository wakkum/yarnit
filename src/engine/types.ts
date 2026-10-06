// Core data model. See ARCHITECTURE.md "Data model" before changing.
// All times are seconds on the shared source timeline (the original recordings).

export type Track = {
  id: string;
  fileName: string;
  /** Seconds to shift this track so synced tracks line up. 0 for single-file projects. */
  offset: number;
  speakerId?: string;
};

export type Speaker = { id: string; name: string };

export type Word = {
  id: string;
  text: string;
  start: number;
  end: number;
  /** Track the word was heard on (loudest track in multitrack projects). */
  trackId: string;
  speakerId?: string;
  isFiller?: boolean;
};

/**
 * A kept span of the source timeline. The ordered list of segments IS the edit:
 * delete = remove/split a segment, move = reorder segments.
 * Every segment plays all tracks for its span, so multitrack edits stay in sync.
 */
export type Segment = { id: string; start: number; end: number };

export const HIGHLIGHT_COLORS = ['red', 'orange', 'green', 'blue', 'purple', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/**
 * A coloured span of the source timeline (so it covers every track at that moment, and can later
 * become segments of a main timeline). Spans never overlap: a new colour replaces what was there.
 */
export type Highlight = { id: string; color: HighlightColor; start: number; end: number };

/**
 * A named piece of a music or sound-effects recording (mockups/parts-a-list.html with the pads of
 * parts-c-pads.html, picked 6 Oct 2026), in source seconds. Parts may overlap; each one can go to the
 * main timeline on its own, as often as needed. The recording itself is never cut.
 */
export type Part = { id: string; name: string; color: HighlightColor; start: number; end: number };

/** What a recording is. Speech kinds get a transcript; music and sound effects don't (Whisper invents lyrics). */
export const RECORDING_KINDS = ['interview', 'voiceover', 'music', 'sfx'] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];
export const isSpeech = (k: RecordingKind) => k === 'interview' || k === 'voiceover';

/** One audio file in a project, with its own transcript and edit. */
export type Recording = {
  id: string;
  name: string;
  kind: RecordingKind;
  sampleRate: number;
  /** Source timeline length in seconds (longest track incl. offset). */
  duration: number;
  tracks: Track[];
  speakers: Speaker[];
  /** Written once by transcription; edits never touch words. */
  words: Word[];
  /** The only thing audio edits change. */
  segments: Segment[];
  highlights: Highlight[];
  /** Optional meaning per colour, e.g. red = "Must keep". */
  highlightNames: Partial<Record<HighlightColor, string>>;
  /** Music and sound effects only, sorted by start. */
  parts: Part[];
};

/**
 * A project: several recordings, each edited on its own. (The main timeline, where passages are
 * copied to build the final version, will live here too.)
 */
export type Project = {
  id: string;
  name: string;
  /** Recording ids in sidebar order. */
  recordingIds: string[];
  /** The recording that was open last, so the project reopens on it. */
  lastRecordingId?: string;
};
