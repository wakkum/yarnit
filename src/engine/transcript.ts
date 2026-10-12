// Transcripts as text, timecoded line by line so the text stays linked to the audio: the blocks a
// recording or the main timeline holds, cut into short lines, and written as plain text, SRT or
// WebVTT subtitles (the Word document is in docx.ts), plus the text copied from a selection.
import { displayWords, sourceToOutput } from './edl';
import { layout } from './main';
import { isSpeech, type MainTimeline, type Recording, type RecordingKind, type Segment } from './types';
import { paragraphs, type Paragraph } from './view';

/** A kept word with its start and end in the edit (seconds). */
export type TimedWord = { id: string; text: string; start: number; end: number };
/** A paragraph of kept words (cut words left out), with its speaker and its start in the edit. */
export type DocPara = { speaker: string; at: number; words: TimedWord[] };
export type DocBlock = { heading: string } | DocPara;
/** One timecoded line of a paragraph. */
export type TextLine = { start: number; end: number; text: string };

const mid = (w: { start: number; end: number }) => (w.start + w.end) / 2;
const textOf = (words: { text: string }[]) => words.map((w) => w.text).join(' ');

/** Paragraphs of an edit as DocParas, skipping those with every word cut; `offset` is where the edit starts. */
function docParas(paras: Paragraph[], segments: Segment[], speaker: (p: Paragraph) => string, offset = 0): DocPara[] {
  return paras.flatMap((p) => {
    const words = p.words.flatMap((d) => {
      if (d.deleted) return [];
      // a word plays where its midpoint lands in the edit
      const m = sourceToOutput(segments, mid(d.word));
      if (m == null) return [];
      return [{ id: d.word.id, text: d.word.text, start: offset + m - (mid(d.word) - d.word.start), end: offset + m + (d.word.end - mid(d.word)) }];
    });
    return words.length ? [{ speaker: speaker(p), at: Math.max(offset, words[0].start), words }] : [];
  });
}

/** The main timeline: a heading per voice clip, then its paragraphs. */
export function transcriptBlocks(main: MainTimeline, kindLabel: (k: RecordingKind) => string): DocBlock[] {
  const out: DocBlock[] = [];
  for (const c of layout(main)) {
    if (!isSpeech(c.kind)) continue;
    const paras = docParas(paragraphs(displayWords(c.words, c.segments)), c.segments, (p) => c.speakers.find((s) => s.id === p.speakerId)?.name ?? 'Speaker', c.start);
    if (paras.length) out.push({ heading: kindLabel(c.kind) }, ...paras);
  }
  return out;
}

/** A recording's edited transcript, paragraph by paragraph (`paras` as the transcript shows them). */
export function recordingBlocks(recording: Recording, paras: Paragraph[]): DocPara[] {
  // a paragraph without a named speaker is labelled by its track, as in the transcript
  const speaker = (p: Paragraph) =>
    recording.speakers.find((s) => s.id === p.speakerId)?.name ?? `Speaker ${Math.max(0, recording.tracks.findIndex((t) => t.id === p.trackId)) + 1}`;
  return docParas(paras, recording.segments, speaker);
}

const endsSentence = (t: string) => /[.?!]["')\]]?$/.test(t);

/**
 * A paragraph cut into lines short enough for a subtitle (two rows of about 42 characters, a few
 * seconds): a line ends after a sentence once it has some length, at a pause, or when it is full.
 */
export function splitLines(words: TimedWord[], { maxChars = 84, maxSeconds = 7, pause = 0.8, minChars = 24 } = {}): TextLine[] {
  const out: TextLine[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length) out.push({ start: cur[0].start, end: cur.at(-1)!.end, text: textOf(cur) });
    cur = [];
  };
  for (const w of words) {
    const prev = cur.at(-1);
    if (prev && (textOf(cur).length + 1 + w.text.length > maxChars || w.start - prev.end > pause || w.end - cur[0].start > maxSeconds)) flush();
    cur.push(w);
    if (endsSentence(w.text) && textOf(cur).length >= minChars) flush();
  }
  flush();
  return out;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** m:ss, or h:mm:ss from an hour (as the app shows times). */
export const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

/** hh:mm:ss, for a timecode in front of a line. */
export const timecode = (s: number) => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;

/** hh:mm:ss,mmm (SRT) or hh:mm:ss.mmm (WebVTT). */
const cueTime = (s: number, sep: ',' | '.') => {
  const ms = Math.round(Math.max(0, s) * 1000);
  return `${pad(ms / 3_600_000)}:${pad((ms % 3_600_000) / 60_000)}:${pad((ms % 60_000) / 1000)}${sep}${pad(ms % 1000, 3)}`;
};

/** A subtitle line over at most two rows: split at the space nearest the middle when it is long. */
function rows(text: string, max = 42): string {
  if (text.length <= max) return text;
  const half = text.length / 2;
  let best = -1;
  for (let i = text.indexOf(' '); i >= 0; i = text.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - half) < Math.abs(best - half)) best = i;
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

const parasOf = (blocks: DocBlock[]) => blocks.filter((b): b is DocPara => !('heading' in b));

/** Plain text: each paragraph under its speaker, every line starting with its timecode. */
export function transcriptTxt(title: string, subtitle: string, blocks: DocBlock[]): string {
  const out = [title, subtitle, ''];
  for (const b of blocks) {
    if ('heading' in b) out.push(b.heading.toUpperCase(), '');
    else out.push(b.speaker, ...splitLines(b.words).map((l) => `[${timecode(l.start)}] ${l.text}`), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** SRT subtitles: one cue per line; with more than one speaker, a paragraph's first cue names its speaker. */
export function transcriptSrt(blocks: DocBlock[]): string {
  const paras = parasOf(blocks);
  const named = new Set(paras.map((p) => p.speaker)).size > 1;
  const cues = paras.flatMap((p) => splitLines(p.words).map((l, i) => ({ ...l, text: named && i === 0 ? `${p.speaker}: ${l.text}` : l.text })));
  return cues.map((c, i) => `${i + 1}\n${cueTime(c.start, ',')} --> ${cueTime(c.end, ',')}\n${rows(c.text)}\n`).join('\n');
}

/** WebVTT subtitles: one cue per line, each with its speaker as a voice tag. */
export function transcriptVtt(blocks: DocBlock[]): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cues = parasOf(blocks).flatMap((p) =>
    splitLines(p.words).map((l) => `${cueTime(l.start, '.')} --> ${cueTime(l.end, '.')}\n<v ${esc(p.speaker)}>${esc(rows(l.text))}`),
  );
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/**
 * The selected words as plain text, for the clipboard: just the words within one paragraph; across
 * several, each paragraph under its speaker and time, separated by a blank line.
 */
export function copyText(blocks: DocBlock[], selected: Set<string>): string {
  const picked = parasOf(blocks).flatMap((b) => {
    const words = b.words.filter((w) => selected.has(w.id));
    return words.length ? [{ ...b, words }] : [];
  });
  if (picked.length === 1) return textOf(picked[0].words);
  return picked.map((p) => `${p.speaker}  ${clock(p.words[0].start)}\n${textOf(p.words)}`).join('\n\n');
}
