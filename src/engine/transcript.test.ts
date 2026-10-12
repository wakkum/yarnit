import { describe, expect, it } from 'vitest';
import { displayWords } from './edl';
import { clock, copyText, recordingBlocks, splitLines, timecode, transcriptBlocks, transcriptSrt, transcriptTxt, transcriptVtt, type DocPara } from './transcript';
import type { MainClip, Recording, RecordingKind } from './types';
import { paragraphs } from './view';

const clip = (id: string, kind: RecordingKind, texts: string[], extra: Partial<MainClip> = {}): MainClip => ({
  id,
  name: id,
  kind,
  recordingId: 'r1',
  trackId: 't1',
  segments: [{ id: 's', start: 0, end: texts.length }],
  words: texts.map((text, i) => ({ id: `${id}${i}`, text, start: i, end: i + 0.8, trackId: 't1', speakerId: 'sp' })),
  speakers: [{ id: 'sp', name: 'Omar' }],
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
  gap: 0,
  at: 0,
  ...extra,
});

const plain = (b: ReturnType<typeof transcriptBlocks>[number]) => ('heading' in b ? b : { speaker: b.speaker, at: b.at, text: b.words.map((w) => w.text).join(' ') });

describe('transcriptBlocks', () => {
  it('lists voice clips in running order with their kept words and times, leaving out cuts and music', () => {
    const main = {
      clips: [
        clip('v', 'voiceover', ['Welcome', 'to', 'the', 'show']),
        // its second word is cut
        clip('i', 'interview', ['Thanks', 'um', 'Omar'], { segments: [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 2, end: 3 }] }),
        clip('m', 'music', [], { segments: [{ id: 'm', start: 0, end: 5 }] }),
      ],
    };
    const blocks = transcriptBlocks(main, (k) => k.toUpperCase());
    expect(blocks.map(plain)).toEqual([
      { heading: 'VOICEOVER' },
      { speaker: 'Omar', at: 0, text: 'Welcome to the show' },
      { heading: 'INTERVIEW' },
      { speaker: 'Omar', at: 4, text: 'Thanks Omar' },
    ]);
    // "Omar" plays 1 s into the interview clip (after the cut), which starts at 4 on the main timeline
    const omar = (blocks[3] as DocPara).words[1];
    expect(omar.start).toBeCloseTo(5);
    expect(omar.end).toBeCloseTo(5.8);
  });
});

const words = [
  { id: 'a', text: 'Alright,', start: 0, end: 0.5, trackId: 't1', speakerId: 'q' },
  { id: 'b', text: 'hello.', start: 0.6, end: 1, trackId: 't1', speakerId: 'q' },
  { id: 'c', text: 'Hi,', start: 5, end: 5.4, trackId: 't1', speakerId: 'm' },
  { id: 'd', text: 'Manny.', start: 5.5, end: 6, trackId: 't1' },
];
const recording = {
  id: 'r',
  name: 'R',
  kind: 'interview',
  duration: 7,
  tracks: [{ id: 't1', name: 'T', offset: 0 }],
  segments: [{ id: 's', start: 0, end: 7 }],
  words,
  speakers: [
    { id: 'q', name: 'Interviewer' },
    { id: 'm', name: 'Manny' },
  ],
  highlights: [],
  highlightNames: {},
  parts: [],
} as unknown as Recording;
const blocks = recordingBlocks(recording, paragraphs(displayWords(words, recording.segments)));

describe('recordingBlocks and copyText', () => {
  it('labels paragraphs by speaker name, or by track when unnamed', () => {
    expect(blocks.map((b) => [b.speaker, b.at, b.words.map((w) => w.id)])).toEqual([
      ['Interviewer', 0, ['a', 'b']],
      ['Manny', 5, ['c']],
      ['Speaker 1', 5.5, ['d']],
    ]);
  });

  it('copies words alone within a paragraph, with speakers and times across paragraphs', () => {
    expect(copyText(blocks, new Set(['b']))).toBe('hello.');
    expect(copyText(blocks, new Set(['b', 'c']))).toBe('Interviewer  0:00\nhello.\n\nManny  0:05\nHi,');
    expect(copyText(blocks, new Set())).toBe('');
  });
});

describe('splitLines', () => {
  const run = (texts: string[], step = 0.5) => texts.map((text, i) => ({ id: `${i}`, text, start: i * step, end: i * step + 0.4 }));

  it('ends a line after a sentence once it has some length, and at a long pause', () => {
    const ws = [...run(['This', 'is', 'the', 'first', 'sentence', 'here.', 'And', 'a', 'second', 'one.']), { id: 'z', text: 'Later.', start: 20, end: 20.5 }];
    expect(splitLines(ws).map((l) => [l.start, l.text])).toEqual([
      [0, 'This is the first sentence here.'],
      [3, 'And a second one.'],
      [20, 'Later.'],
    ]);
  });

  it('keeps lines within the character and time limits', () => {
    const many = run(Array.from({ length: 40 }, (_, i) => `word${i}`), 0.3);
    const lines = splitLines(many);
    expect(lines.every((l) => l.text.length <= 84 && l.end - l.start <= 7)).toBe(true);
    expect(lines.map((l) => l.text).join(' ')).toBe(many.map((w) => w.text).join(' '));
  });
});

describe('text formats', () => {
  it('formats times', () => {
    expect(clock(65)).toBe('1:05');
    expect(timecode(3725.9)).toBe('01:02:05');
  });

  it('writes plain text with a timecode on every line', () => {
    expect(transcriptTxt('R', 'Transcript', [{ heading: 'Interview' }, ...blocks])).toBe(
      'R\nTranscript\n\nINTERVIEW\n\nInterviewer\n[00:00:00] Alright, hello.\n\nManny\n[00:00:05] Hi,\n\nSpeaker 1\n[00:00:05] Manny.\n',
    );
  });

  it('writes SRT cues, naming the speaker when there is more than one', () => {
    expect(transcriptSrt(blocks)).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\nInterviewer: Alright, hello.\n\n2\n00:00:05,000 --> 00:00:05,400\nManny: Hi,\n\n3\n00:00:05,500 --> 00:00:06,000\nSpeaker 1: Manny.\n',
    );
    expect(transcriptSrt([blocks[0]])).toBe('1\n00:00:00,000 --> 00:00:01,000\nAlright, hello.\n');
  });

  it('writes WebVTT cues with voice tags, splitting long lines over two rows', () => {
    const long = { speaker: 'A & B', at: 0, words: 'one two three four five six seven eight nine ten eleven twelve'.split(' ').map((text, i) => ({ id: `${i}`, text, start: i * 0.3, end: i * 0.3 + 0.2 })) };
    expect(transcriptVtt([long])).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:03.500\n<v A &amp; B>one two three four five six seven\neight nine ten eleven twelve\n');
  });
});
