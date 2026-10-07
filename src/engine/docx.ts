// The main timeline's transcript as a Word document (.docx): the voice clips in running order, each
// under a heading with its kind, then paragraphs with the speaker and the time on the main timeline.
import { displayWords, sourceToOutput } from './edl';
import { layout } from './main';
import { isSpeech, type MainTimeline, type RecordingKind } from './types';
import { paragraphs } from './view';
import { zipStored } from './zip';

export type DocBlock = { heading: string } | { speaker: string; at: number; text: string };

/** What the document holds: a heading per voice clip, then its kept words paragraph by paragraph (cut words left out). */
export function transcriptBlocks(main: MainTimeline, kindLabel: (k: RecordingKind) => string): DocBlock[] {
  const out: DocBlock[] = [];
  for (const c of layout(main)) {
    if (!isSpeech(c.kind)) continue;
    const paras = paragraphs(displayWords(c.words, c.segments))
      .map((p) => ({ p, text: p.words.filter((d) => !d.deleted).map((d) => d.word.text).join(' ') }))
      .filter((x) => x.text);
    if (!paras.length) continue;
    out.push({ heading: kindLabel(c.kind) });
    for (const { p, text } of paras) {
      const speaker = c.speakers.find((s) => s.id === p.speakerId)?.name ?? 'Speaker';
      // looked up just after the paragraph's start, so a start on a cut edge still finds its segment
      const at = sourceToOutput(c.segments, p.start + 0.001);
      out.push({ speaker, at: c.start + Math.max(0, (at ?? 0.001) - 0.001), text });
    }
  }
  return out;
}

/** m:ss, or h:mm:ss from an hour. */
export const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Text for XML: escaped, and without the control characters XML can't hold. */
// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (text: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (inner: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const STYLES = `${HEAD}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:color w:val="666666"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
</w:styles>`;

const FILES = {
  '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  '_rels/.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  'word/styles.xml': STYLES,
};

/** The document.xml body for `blocks`, under a title and subtitle. */
export function documentXml(title: string, subtitle: string, blocks: DocBlock[]): string {
  const body = [
    para(run(title), 'Title'),
    para(run(subtitle), 'Subtitle'),
    ...blocks.map((b) => ('heading' in b ? para(run(b.heading), 'Heading1') : para(`${run(`${b.speaker}  ${clock(b.at)}`, true)}<w:r><w:br/></w:r>${run(b.text)}`))),
  ].join('');
  return `${HEAD}<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

/** A complete .docx file. */
export function docxFile(title: string, subtitle: string, blocks: DocBlock[]): Uint8Array {
  const enc = new TextEncoder();
  const files = { ...FILES, 'word/document.xml': documentXml(title, subtitle, blocks) };
  return zipStored(Object.entries(files).map(([name, text]) => ({ name, data: enc.encode(text) })));
}
