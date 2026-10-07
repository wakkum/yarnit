import { describe, expect, it } from 'vitest';
import { clock, docxFile, documentXml, transcriptBlocks } from './docx';
import type { MainClip, RecordingKind } from './types';
import { crc32, zipStored } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

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

describe('zipStored', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes local headers, a central directory and the end record', () => {
    const zip = zipStored([
      { name: 'a.txt', data: enc.encode('hello') },
      { name: 'b/c.xml', data: enc.encode('<x/>') },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(dec.decode(zip.subarray(30, 35))).toBe('a.txt');
    expect(dec.decode(zip.subarray(35, 40))).toBe('hello');
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const dirAt = v.getUint32(end + 16, true);
    expect(v.getUint32(dirAt, true)).toBe(0x02014b50);
    // the second entry's local header offset points at a local header
    const second = dirAt + 46 + 'a.txt'.length;
    expect(v.getUint32(zip.byteOffset + v.getUint32(second + 42, true), true)).toBe(0x04034b50);
  });
});

describe('transcriptBlocks', () => {
  it('lists voice clips in running order with their kept words, leaving out cuts and music', () => {
    const main = {
      clips: [
        clip('v', 'voiceover', ['Welcome', 'to', 'the', 'show']),
        // its second word is cut
        clip('i', 'interview', ['Thanks', 'um', 'Omar'], { segments: [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 2, end: 3 }] }),
        clip('m', 'music', [], { segments: [{ id: 'm', start: 0, end: 5 }] }),
      ],
    };
    const blocks = transcriptBlocks(main, (k) => k.toUpperCase());
    expect(blocks).toEqual([
      { heading: 'VOICEOVER' },
      { speaker: 'Omar', at: 0, text: 'Welcome to the show' },
      { heading: 'INTERVIEW' },
      { speaker: 'Omar', at: 4, text: 'Thanks Omar' },
    ]);
  });
});

describe('docx', () => {
  it('escapes text and formats times', () => {
    const x = documentXml('Q&A <draft>', 'sub', [{ speaker: 'A "B"', at: 3725, text: 'x < y \u0007' }]);
    expect(x).toContain('Q&amp;A &lt;draft&gt;');
    expect(x).toContain('A &quot;B&quot;  1:02:05');
    expect(x).toContain('x &lt; y </w:t>');
    expect(clock(65)).toBe('1:05');
  });

  it('packs the parts Word needs', () => {
    const file = docxFile('T', 'S', [{ heading: 'Interview' }]);
    const text = dec.decode(file);
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/document.xml']) expect(text).toContain(part);
    expect(text).toContain('<w:pStyle w:val="Heading1"/>');
  });
});
