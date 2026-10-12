import { describe, expect, it } from 'vitest';
import { docxFile, documentXml } from './docx';
import { crc32, zipStored } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();

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
    expect(v.getUint32(v.getUint32(second + 42, true), true)).toBe(0x04034b50);
  });
});

describe('docx', () => {
  const words = [
    { id: 'a', text: 'x', start: 3725, end: 3725.4 },
    { id: 'b', text: '<', start: 3725.5, end: 3725.6 },
    { id: 'c', text: 'y.\u0007', start: 3725.7, end: 3726 },
  ];

  it('escapes text and timecodes every line', () => {
    const x = documentXml('Q&A <draft>', 'sub', [{ heading: 'Interview' }, { speaker: 'A "B"', at: 3725, words }]);
    expect(x).toContain('Q&amp;A &lt;draft&gt;');
    expect(x).toContain('<w:pStyle w:val="Heading1"/>');
    expect(x).toContain('A &quot;B&quot;');
    expect(x).toContain('[01:02:05] </w:t>');
    expect(x).toContain('x &lt; y.</w:t>');
  });

  it('packs the parts Word needs', () => {
    const text = dec.decode(docxFile('T', 'S', [{ heading: 'Interview' }]));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/document.xml']) expect(text).toContain(part);
  });
});
