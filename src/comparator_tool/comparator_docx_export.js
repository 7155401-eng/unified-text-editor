import { zipSync, strToU8 } from "fflate";

const XML_NS = "http://www.w3.org/XML/1998/namespace";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const CT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const RELS_PKG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const RELS_DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${WORD_NS}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:bidi/></w:pPr>
    <w:rPr><w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="FootnoteText">
    <w:name w:val="footnote text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:bidi/></w:pPr>
    <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="FootnoteReference">
    <w:name w:val="footnote reference"/>
    <w:semiHidden/>
    <w:rPr><w:vertAlign w:val="superscript"/></w:rPr>
  </w:style>
</w:styles>`;

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${WORD_NS}">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="708"/>
  <w:footnotePr>
    <w:footnote w:id="-1"/>
    <w:footnote w:id="0"/>
  </w:footnotePr>
</w:settings>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>RavText</Application>
</Properties>`;

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanHexColor(value) {
  const v = String(value || "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(v)) return v.split("").map(c => c + c).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  return "";
}

function safeFont(value) {
  return String(value || "").replace(/[<>&"']/g, "").trim().slice(0, 80);
}

function halfPointsFromQuillSize(value) {
  const s = String(value || "").trim().toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (s.endsWith("px")) return Math.max(2, Math.round(n * 1.5));
  if (s.endsWith("pt")) return Math.max(2, Math.round(n * 2));
  return null;
}

function runProperties(attrs = {}, extra = {}) {
  const bits = [];
  if (attrs.bold || extra.bold) bits.push("<w:b/>");
  if (attrs.italic) bits.push("<w:i/>");
  if (attrs.underline) bits.push('<w:u w:val="single"/>');
  if (attrs.strike) bits.push("<w:strike/>");

  const script = attrs.script === "super" ? "superscript"
    : attrs.script === "sub" ? "subscript" : "";
  if (script) bits.push(`<w:vertAlign w:val="${script}"/>`);

  const color = cleanHexColor(attrs.color);
  if (color) bits.push(`<w:color w:val="${color}"/>`);

  const fill = cleanHexColor(attrs.background);
  if (fill) bits.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);

  const font = safeFont(attrs.font);
  if (font) {
    const esc = xmlEscape(font);
    bits.push(`<w:rFonts w:ascii="${esc}" w:hAnsi="${esc}" w:cs="${esc}"/>`);
  }

  const hp = halfPointsFromQuillSize(attrs.size);
  if (hp) bits.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);

  if (extra.footnoteReference) bits.push('<w:rStyle w:val="FootnoteReference"/>');
  return bits.length ? `<w:rPr>${bits.join("")}</w:rPr>` : "";
}

function textRun(text, attrs = {}, extra = {}) {
  if (!text) return "";
  const preserve = /^\s|\s$/u.test(text) ? ' xml:space="preserve"' : "";
  return `<w:r>${runProperties(attrs, extra)}<w:t${preserve}>${xmlEscape(text)}</w:t></w:r>`;
}

function specialRun(kind, attrs = {}) {
  if (kind === "tab") return `<w:r>${runProperties(attrs)}<w:tab/></w:r>`;
  if (kind === "break") return `<w:r>${runProperties(attrs)}<w:br/></w:r>`;
  return "";
}

function footnoteReferenceRun(id) {
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

function footnoteNumberRun() {
  return '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>';
}

function paragraphProperties(attrs = {}, footnote = false) {
  const bits = [];
  if (footnote) bits.push('<w:pStyle w:val="FootnoteText"/>');
  bits.push("<w:bidi/>");

  const alignMap = {
    center: "center",
    right: "right",
    justify: "both",
    left: "left",
  };
  const align = alignMap[String(attrs.align || "")];
  if (align) bits.push(`<w:jc w:val="${align}"/>`);

  return `<w:pPr>${bits.join("")}</w:pPr>`;
}

function deltaModel(delta) {
  const ops = Array.isArray(delta?.ops) ? delta.ops : [];
  let text = "";
  const runs = [];

  for (const op of ops) {
    if (typeof op?.insert !== "string") {
      throw Object.assign(
        new Error("המסמך מכיל embed/אובייקט שאינו נתמך בייצוא DOCX המהיר."),
        { code: "UNSUPPORTED_COMPARATOR_EMBED" }
      );
    }
    if (!op.insert) continue;
    const start = text.length;
    text += op.insert;
    runs.push({
      start,
      end: text.length,
      text: op.insert,
      attrs: { ...(op.attributes || {}) },
    });
  }

  return { text, runs };
}

function attrsAt(model, pos) {
  const run = model.runs.find(r => pos >= r.start && pos < r.end);
  return run ? run.attrs : {};
}

function renderRange(model, start, end) {
  if (end <= start) return "";
  const out = [];
  for (const run of model.runs) {
    const a = Math.max(start, run.start);
    const b = Math.min(end, run.end);
    if (b <= a) continue;
    const chunk = run.text.slice(a - run.start, b - run.start);

    let buf = "";
    const flush = () => {
      if (buf) {
        out.push(textRun(buf, run.attrs));
        buf = "";
      }
    };

    for (const ch of chunk) {
      if (ch === "\t") {
        flush();
        out.push(specialRun("tab", run.attrs));
      } else if (ch === "\n") {
        // Newlines are paragraph boundaries and must not arrive here.
        flush();
      } else {
        buf += ch;
      }
    }
    flush();
  }
  return out.join("");
}

function paragraphRanges(model, start = 0, end = model.text.length) {
  const ranges = [];
  let pStart = start;
  for (let i = start; i < end; i++) {
    if (model.text[i] !== "\n") continue;
    ranges.push({
      start: pStart,
      end: i,
      attrs: attrsAt(model, i),
    });
    pStart = i + 1;
  }
  ranges.push({ start: pStart, end, attrs: {} });
  return ranges;
}

function normalizeMarkers(streams) {
  const out = [];
  const seen = new Set();
  streams.forEach((s, index) => {
    const marker = String(s?.marker || "").trim();
    if (!marker) throw Object.assign(new Error(`לזרם ${index + 1} חסר סימון קישור.`), { code: "MISSING_STREAM_MARKER" });
    if (seen.has(marker)) throw Object.assign(new Error(`הסימון ${marker} מופיע ביותר מזרם אחד.`), { code: "DUPLICATE_STREAM_MARKER" });
    if (marker.includes("\n")) throw Object.assign(new Error("סימון קישור אינו יכול להכיל ירידת שורה."), { code: "INVALID_STREAM_MARKER" });
    seen.add(marker);
    out.push({ ...s, marker, index });
  });
  return out.sort((a, b) => b.marker.length - a.marker.length || a.index - b.index);
}

function scanMarkers(text, streams) {
  const events = [];
  for (let i = 0; i < text.length;) {
    let found = null;
    for (const s of streams) {
      if (text.startsWith(s.marker, i)) {
        found = s;
        break;
      }
    }
    if (!found) {
      i += 1;
      continue;
    }
    events.push({ pos: i, end: i + found.marker.length, stream: found });
    i += found.marker.length;
  }
  return events;
}

function trimRange(model, start, end) {
  let a = start;
  let b = end;
  while (a < b && /\s/u.test(model.text[a])) a++;
  while (b > a && /\s/u.test(model.text[b - 1])) b--;
  return { start: a, end: b };
}

function streamNoteRanges(stream) {
  const model = deltaModel(stream.delta);
  const occurrences = [];
  let i = 0;
  while (i < model.text.length) {
    const at = model.text.indexOf(stream.marker, i);
    if (at < 0) break;
    occurrences.push(at);
    i = at + stream.marker.length;
  }

  if (!occurrences.length) {
    if (model.text.trim()) {
      throw Object.assign(
        new Error(`בזרם ${stream.marker} יש טקסט, אך אין אף סימון ${stream.marker}.`),
        { code: "STREAM_WITHOUT_MARKERS", marker: stream.marker }
      );
    }
    return { model, notes: [] };
  }

  if (model.text.slice(0, occurrences[0]).trim()) {
    throw Object.assign(
      new Error(`בזרם ${stream.marker} יש טקסט לפני הסימון הראשון. לא ניתן לדעת לאיזו הערה הוא שייך.`),
      { code: "AMBIGUOUS_STREAM_PREFIX", marker: stream.marker }
    );
  }

  const notes = [];
  for (let n = 0; n < occurrences.length; n++) {
    const start = occurrences[n];
    const end = n + 1 < occurrences.length ? occurrences[n + 1] : model.text.length;
    const trimmed = trimRange(model, start, end);
    if (trimmed.end <= trimmed.start + stream.marker.length) {
      throw Object.assign(
        new Error(`בזרם ${stream.marker} נמצאה הערה ריקה מספר ${n + 1}.`),
        { code: "EMPTY_STREAM_NOTE", marker: stream.marker, ordinal: n + 1 }
      );
    }
    notes.push(trimmed);
  }

  return { model, notes };
}

function buildPlan(mainDelta, streamsInput) {
  const main = deltaModel(mainDelta);
  const streams = normalizeMarkers(streamsInput).map(s => {
    const parsed = streamNoteRanges(s);
    return { ...s, ...parsed, cursor: 0 };
  });

  const mainEvents = scanMarkers(main.text, streams);
  const countByMarker = Object.create(null);
  mainEvents.forEach(e => { countByMarker[e.stream.marker] = (countByMarker[e.stream.marker] || 0) + 1; });

  for (const stream of streams) {
    const refs = countByMarker[stream.marker] || 0;
    if (refs !== stream.notes.length) {
      throw Object.assign(
        new Error(
          `אי־התאמה בזרם ${stream.marker}: בטקסט הראשי יש ${refs} הפניות, ובזרם יש ${stream.notes.length} הערות. הייצוא נעצר כדי לא לקשר הערות למקום שגוי.`
        ),
        {
          code: "STREAM_REFERENCE_COUNT_MISMATCH",
          marker: stream.marker,
          references: refs,
          notes: stream.notes.length,
        }
      );
    }
  }

  let nextId = 1;
  const footnotes = [];
  const events = mainEvents.map(event => {
    const stream = streams.find(s => s.marker === event.stream.marker);
    const noteRange = stream.notes[stream.cursor++];
    const id = nextId++;
    footnotes.push({
      id,
      marker: stream.marker,
      model: stream.model,
      range: noteRange,
    });
    return { ...event, footnoteId: id };
  });

  return { main, streams, events, footnotes };
}

function mainDocumentXml(plan) {
  const body = [];
  const paragraphs = paragraphRanges(plan.main);

  for (const p of paragraphs) {
    const events = plan.events.filter(e => e.pos >= p.start && e.pos < p.end);
    let cursor = p.start;
    let runs = "";
    for (const e of events) {
      if (e.pos > cursor) runs += renderRange(plan.main, cursor, e.pos);
      runs += footnoteReferenceRun(e.footnoteId);
      cursor = e.end;
    }
    if (cursor < p.end) runs += renderRange(plan.main, cursor, p.end);
    body.push(`<w:p>${paragraphProperties(p.attrs, false)}${runs}</w:p>`);
  }

  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:bidi/></w:sectPr>');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}" xmlns:xml="${XML_NS}"><w:body>${body.join("")}</w:body></w:document>`;
}

function footnoteBodyXml(note) {
  const paragraphs = paragraphRanges(note.model, note.range.start, note.range.end);
  return paragraphs.map((p, index) => {
    let runs = "";
    if (index === 0) runs += footnoteNumberRun();
    runs += renderRange(note.model, p.start, p.end);
    return `<w:p>${paragraphProperties(p.attrs, true)}${runs}</w:p>`;
  }).join("");
}

function footnotesXml(plan) {
  let body =
    '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
    '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';

  for (const note of plan.footnotes) {
    body += `<w:footnote w:id="${note.id}">${footnoteBodyXml(note)}</w:footnote>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${WORD_NS}" xmlns:xml="${XML_NS}">${body}</w:footnotes>`;
}

function coreXml(title) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title || "RavText")}</dc:title>
  <dc:creator>RavText</dc:creator>
  <cp:lastModifiedBy>RavText</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

export function validateComparatorFootnoteMerge(mainDelta, streams) {
  const plan = buildPlan(mainDelta, streams);
  return {
    references: plan.events.length,
    footnotes: plan.footnotes.length,
    streams: plan.streams.map(s => ({
      marker: s.marker,
      notes: s.notes.length,
    })),
  };
}

export function buildComparatorDocxBytes({
  mainDelta,
  streams,
  title = "רב טקסט",
} = {}) {
  const plan = buildPlan(mainDelta, streams || []);
  if (!plan.events.length) {
    throw Object.assign(
      new Error("לא נמצאו סימוני הערות בטקסט הראשי."),
      { code: "NO_MAIN_NOTE_MARKERS" }
    );
  }

  const documentXml = mainDocumentXml(plan);
  const notesXml = footnotesXml(plan);

  const files = {
    "[Content_Types].xml": strToU8(CT_XML),
    "_rels/.rels": strToU8(RELS_PKG),
    "word/_rels/document.xml.rels": strToU8(RELS_DOC),
    "word/document.xml": strToU8(documentXml),
    "word/footnotes.xml": strToU8(notesXml),
    "word/styles.xml": strToU8(STYLES_XML),
    "word/settings.xml": strToU8(SETTINGS_XML),
    "docProps/core.xml": strToU8(coreXml(title)),
    "docProps/app.xml": strToU8(APP_XML),
  };

  const bytes = zipSync(files);
  return {
    bytes,
    report: {
      references: plan.events.length,
      footnotes: plan.footnotes.length,
      streams: plan.streams.map(s => ({ marker: s.marker, notes: s.notes.length })),
    },
  };
}

export function comparatorDocxFilename(originalName) {
  const raw = String(originalName || "").trim();
  const base = raw ? raw.replace(/\.[^.]+$/u, "") : "רב טקסט בוורד";
  return `${base} (ממוזג).docx`;
}

export function downloadComparatorDocx(bytes, filename) {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "רב טקסט (ממוזג).docx";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { a.remove(); } catch (_) {}
    try { URL.revokeObjectURL(url); } catch (_) {}
  }, 300);
}
