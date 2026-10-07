import { describe, expect, it } from 'vitest';
import {
  baseName,
  fromSavedProject,
  guessKind,
  fromSavedRecording,
  migrateV1,
  SAVE_VERSION,
  summarizeProject,
  summarizeRecording,
  toSavedProject,
  toSavedRecording,
} from './save';
import type { Recording } from './types';

const recording: Recording = {
  id: 'r1',
  name: 'talk.wav',
  kind: 'interview',
  sampleRate: 44_100,
  duration: 10,
  tracks: [{ id: 't1', fileName: 'talk.wav', offset: 0, speakerId: 'sp1' }],
  speakers: [{ id: 'sp1', name: 'Ann' }],
  words: [{ id: 'w1', text: 'hi', start: 0.5, end: 0.9, trackId: 't1', speakerId: 'sp1' }],
  segments: [
    { id: 's1', start: 0, end: 4 },
    { id: 's2', start: 6, end: 10 },
  ],
  highlights: [{ id: 'h1', color: 'red', start: 0.5, end: 0.9 }],
  highlightNames: { red: 'Must keep' },
  parts: [{ id: 'pt1', name: 'Intro', color: 'blue', start: 1, end: 3 }],
};

describe('recordings', () => {
  it('round-trip through JSON unchanged', () => {
    const back = fromSavedRecording(JSON.parse(JSON.stringify(toSavedRecording(recording, true, 123))));
    expect(back).toEqual({ version: SAVE_VERSION, savedAt: 123, transcribed: true, recording });
  });

  it('fill fields that older saves lack', () => {
    const { highlights: _h, highlightNames: _n, speakers: _s, kind: _k, parts: _p, ...old } = recording;
    const back = fromSavedRecording({ version: 1, savedAt: 1, recording: old });
    expect(back?.recording.highlights).toEqual([]);
    expect(back?.recording.highlightNames).toEqual({});
    expect(back?.recording.speakers).toEqual([]);
    expect(back?.recording.kind).toBe('interview');
    expect(back?.recording.parts).toEqual([]);
    expect(back?.transcribed).toBe(true);
  });

  it('reject junk and saves from a newer version', () => {
    expect(fromSavedRecording(null)).toBeNull();
    expect(fromSavedRecording({ version: 2, recording: { id: 'x' } })).toBeNull();
    expect(fromSavedRecording({ ...toSavedRecording(recording, true, 1), version: SAVE_VERSION + 1 })).toBeNull();
  });

  it('drop broken parts and keep the rest sorted', () => {
    const parts = [{ id: 'b', name: 'B', color: 'red', start: 5, end: 6 }, { id: 'x', name: 'X', color: 'teal', start: 0, end: 1 }, { id: 'y', name: 'Y', color: 'red', start: 4, end: 4 }, ...recording.parts];
    expect(fromSavedRecording(toSavedRecording({ ...recording, parts } as Recording, true, 1))?.recording.parts.map((x) => x.id)).toEqual(['pt1', 'b']);
  });

  it('drop highlights with an unknown colour', () => {
    const odd = { ...recording, highlights: [...recording.highlights, { id: 'h2', color: 'teal', start: 1, end: 2 }] };
    expect(fromSavedRecording(toSavedRecording(odd as Recording, true, 1))?.recording.highlights).toEqual(recording.highlights);
  });

  it('summarize the edit length and counts', () => {
    expect(summarizeRecording(toSavedRecording(recording, false, 5))).toEqual({
      id: 'r1',
      name: 'talk.wav',
      kind: 'interview',
      duration: 10,
      edited: 8,
      words: 1,
      highlights: 1,
      parts: 1,
      transcribed: false,
      savedAt: 5,
      trackIds: ['t1'],
    });
  });
});

describe('projects', () => {
  const project = { id: 'p1', name: 'Episode 3', recordingIds: ['r1', 'r2'], lastRecordingId: 'r1' };

  it('round-trip and default a missing name', () => {
    expect(fromSavedProject(JSON.parse(JSON.stringify(toSavedProject(project, 7))))).toEqual({ version: SAVE_VERSION, savedAt: 7, project });
    expect(fromSavedProject({ version: 2, project: { id: 'p2' } })?.project).toEqual({ id: 'p2', name: 'Untitled project', recordingIds: [] });
    expect(fromSavedProject({ version: 2, project: {} })).toBeNull();
  });

  it('keep the main timeline, dropping clips that cannot play and fixing bad numbers', () => {
    const good = { id: 'c1', name: 'Bed', kind: 'music', recordingId: 'r1', trackId: 't1', segments: [{ id: 's', start: 0, end: 5 }], words: [], speakers: [], gain: 9, fadeIn: -1, fadeOut: 2, gap: 0, at: 3 };
    const saved = { version: 2, savedAt: 1, project: { ...project, mainOpen: true, main: { clips: [good, { ...good, id: 'c2', kind: 'banjo' }, { ...good, id: 'c3', segments: [] }, null] } } };
    const back = fromSavedProject(JSON.parse(JSON.stringify(saved)))!.project;
    expect(back.mainOpen).toBe(true);
    expect(back.main!.clips.map((c) => c.id)).toEqual(['c1']);
    expect(back.main!.clips[0]).toMatchObject({ gain: 2, fadeIn: 0, fadeOut: 2, at: 3 });
  });

  it('summarize over their own recordings only, newest save wins', () => {
    const a = summarizeRecording(toSavedRecording(recording, true, 50));
    const other = { ...a, id: 'zz', edited: 99 };
    expect(summarizeProject(toSavedProject(project, 10), [a, other])).toEqual({ id: 'p1', name: 'Episode 3', recordings: 1, duration: 8, savedAt: 50 });
  });
});

describe('migrateV1', () => {
  it('turns an old one-file save into a project holding that recording', () => {
    const { kind: _k, ...old } = recording;
    const m = migrateV1({ version: 1, savedAt: 9, transcribed: false, project: old })!;
    expect(m.recording).toEqual({ version: SAVE_VERSION, savedAt: 9, transcribed: false, recording });
    expect(m.project).toEqual({ version: SAVE_VERSION, savedAt: 9, project: { id: 'pj-r1', name: 'talk', recordingIds: ['r1'], lastRecordingId: 'r1' } });
  });

  it('leaves anything else alone', () => {
    expect(migrateV1({ version: 2, project: {} })).toBeNull();
    expect(migrateV1('x')).toBeNull();
  });

  it('guesses short files are sound effects', () => {
    expect(guessKind(2)).toBe('sfx');
    expect(guessKind(600)).toBe('interview');
    expect(guessKind(0)).toBe('interview'); // unknown length
  });
  it('names from file names', () => {
    expect(baseName('Interview with Omar.m4a')).toBe('Interview with Omar');
    expect(baseName('.wav')).toBe('.wav');
  });
});
