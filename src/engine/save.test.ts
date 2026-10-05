import { describe, expect, it } from 'vitest';
import { fromSaved, SAVE_VERSION, summarize, toSaved } from './save';
import type { Project } from './types';

const project: Project = {
  id: 'p1',
  name: 'talk.wav',
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
};

describe('save format', () => {
  it('round-trips through JSON unchanged', () => {
    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(project, true, 123))));
    expect(back).toEqual({ version: SAVE_VERSION, savedAt: 123, transcribed: true, project });
  });

  it('fills fields that older saves lack', () => {
    const { highlights: _h, highlightNames: _n, speakers: _s, ...old } = project;
    const back = fromSaved({ version: 1, savedAt: 1, project: old });
    expect(back?.project.highlights).toEqual([]);
    expect(back?.project.highlightNames).toEqual({});
    expect(back?.project.speakers).toEqual([]);
    expect(back?.transcribed).toBe(true);
  });

  it('rejects junk and saves from a newer version', () => {
    expect(fromSaved(null)).toBeNull();
    expect(fromSaved({ version: 1, project: { id: 'x' } })).toBeNull();
    expect(fromSaved({ ...toSaved(project, true, 1), version: SAVE_VERSION + 1 })).toBeNull();
  });

  it('drops highlights with an unknown colour', () => {
    const odd = { ...project, highlights: [...project.highlights, { id: 'h2', color: 'teal', start: 1, end: 2 }] };
    expect(fromSaved(toSaved(odd as Project, true, 1))?.project.highlights).toEqual(project.highlights);
  });

  it('summarizes the edit length and counts', () => {
    expect(summarize(toSaved(project, false, 5))).toEqual({
      id: 'p1',
      name: 'talk.wav',
      duration: 10,
      edited: 8,
      words: 1,
      highlights: 1,
      transcribed: false,
      savedAt: 5,
      trackIds: ['t1'],
    });
  });
});
