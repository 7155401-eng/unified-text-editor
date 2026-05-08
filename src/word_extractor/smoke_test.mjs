// smoke_test.mjs — node-only sanity tests for pure functions.
// Run: node src/word_extractor/smoke_test.mjs
//
// This does NOT exercise DOCX/XML paths (which require DOMParser/JSZip in browser).

import {
  RichText, CharToken, rich_sub,
  _balance_braces, _clean_latex,
  _extract_opening_segment, _is_orphan_note,
  _mk_fn, _mk_sidenote,
} from "./word_extractor_engine.js";
import { buildDefaultStreamMapping, streamsToSd, findDuplicateSeries } from "./word_extractor_streams.js";
import { SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT, SOURCE_SIDENOTE } from "./word_extractor_i18n.js";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra || ""); }
}

// === RichText ===
{
  const rt = new RichText();
  rt.append("a", true);
  rt.append("b");
  rt.append("c", false, true);
  ok("RichText.get_text", rt.get_text() === "abc");
  ok("RichText.copy is independent", (() => {
    const c = rt.copy();
    c.tokens[0].b = false;
    return rt.tokens[0].b === true;
  })());
  const tex = rt.to_latex();
  ok("RichText.to_latex contains ravtextbf", tex.includes("\\ravtextbf{a}"), tex);
  ok("RichText.to_latex contains textit", tex.includes("\\textit{c}"), tex);
}

// === rich_sub: basic ===
{
  const rt = new RichText();
  for (const ch of "Hello") rt.append(ch);
  const result = rich_sub(/Hello/, () => "World", rt);
  ok("rich_sub Hello->World", result.get_text() === "World");
  ok("rich_sub all is_raw_latex", result.tokens.every(t => t.is_raw_latex));
}

// === rich_sub: formatting preserved ===
{
  const rt = new RichText();
  rt.append("A", true);
  rt.append("B", false, true);
  rt.append("C", false, false, true);
  rt.append("D", false, false, false, 24);
  rt.append("E", false, false, false, 0, "FF0000");
  const result = rich_sub(/B/, () => "X", rt);
  ok("rich_sub B->X text", result.get_text() === "AXCDE");
  ok("rich_sub A bold preserved", result.tokens[0].b === true);
  ok("rich_sub X is_raw_latex", result.tokens[1].is_raw_latex === true);
  ok("rich_sub C underline preserved", result.tokens[2].u === true);
  ok("rich_sub D size preserved", result.tokens[3].sz === 24);
  ok("rich_sub E color preserved", result.tokens[4].col === "FF0000");
}

// === rich_sub: no match ===
{
  const rt = new RichText();
  rt.append("A"); rt.append("B");
  const result = rich_sub(/Z/, () => "C", rt);
  ok("rich_sub no match returns same", result === rt);
}

// === _balance_braces ===
{
  ok("_balance_braces balanced", _balance_braces("{a}") === "{a}");
  ok("_balance_braces missing close", _balance_braces("{a") === "{a}");
  ok("_balance_braces missing open", _balance_braces("a}") === "{a}");
  ok("_balance_braces escaped", _balance_braces("\\{a") === "\\{a");
}

// === _clean_latex ===
{
  ok("_clean_latex collapses ws", _clean_latex("a   b") === "a b");
  ok("_clean_latex strips \\par", _clean_latex("a \\par b") === "a b");
  ok("_clean_latex newlines->space", _clean_latex("a\nb\rc") === "a b c");
}

// === _extract_opening_segment ===
{
  // word mode, count=1
  const [p, s, suf] = _extract_opening_segment("Hello World", "מילה", 1);
  ok("opening_segment word=1 prefix empty", p === "");
  ok("opening_segment word=1 segment", s === "Hello");
  ok("opening_segment word=1 suffix", suf === " World");
}
{
  // letter mode, count=2
  const [p, s, suf] = _extract_opening_segment("שלום עולם", "אות", 2);
  ok("opening_segment letter=2 segment", s === "של", `got ${s}`);
}
{
  // leading textbf
  const [p, s, suf] = _extract_opening_segment("\\textbf{שיהא טוב} extra", "מילה", 1);
  ok("opening_segment textbf wrapped", s === "\\textbf{שיהא}", `got ${s}`);
  ok("opening_segment textbf suffix has rest", suf.includes("\\textbf{ טוב}"), `got ${suf}`);
}

// === _is_orphan_note ===
{
  ok("_is_orphan_note short", _is_orphan_note("hi") === true);
  ok("_is_orphan_note long",
    _is_orphan_note("a".repeat(100)) === false);
}

// === _mk_fn ===
{
  const out = _mk_fn("A", "hello");
  ok("_mk_fn opens \\footnoteA", out.startsWith("\\footnoteA{"), out);
  ok("_mk_fn includes setRTL", out.includes("\\setRTL"), out);
  ok("_mk_fn includes streamfont", out.includes("\\streamfontA"), out);
  ok("_mk_fn paragraph layout no \\par",
    !_mk_fn("A", "x", null, null, "paragraph").includes("\\unskip\\null\\par"));
}

// === _mk_sidenote ===
{
  const out = _mk_sidenote("right", "\\sansfont", "text");
  ok("_mk_sidenote right", out.startsWith("\\ledrightnote{"), out);
  ok("_mk_sidenote contains RL", out.includes("\\RL{"), out);
}

// === buildDefaultStreamMapping ===
{
  const sources = [
    { id: "footnote_@01", source_type: SOURCE_FOOTNOTE, marker: "01", count: 5 },
    { id: "endnote_@02", source_type: SOURCE_ENDNOTE, marker: "02", count: 3 },
    { id: "comment_@03", source_type: SOURCE_COMMENT, marker: "03", count: 2 },
  ];
  const mapped = buildDefaultStreamMapping(sources);
  ok("default mapping count", mapped.length === 3);
  const fn = mapped.find(s => s.source_type === SOURCE_FOOTNOTE);
  const en = mapped.find(s => s.source_type === SOURCE_ENDNOTE);
  const cm = mapped.find(s => s.source_type === SOURCE_COMMENT);
  ok("default series footnote=A", fn.series === "A", `got ${fn.series}`);
  ok("default series endnote=B", en.series === "B", `got ${en.series}`);
  ok("default series comment=C", cm.series === "C", `got ${cm.series}`);
}

// === buildDefaultStreamMapping: two of same type get distinct letters ===
{
  const sources = [
    { id: "footnote_@01", source_type: SOURCE_FOOTNOTE, marker: "01", count: 5 },
    { id: "footnote_@02", source_type: SOURCE_FOOTNOTE, marker: "02", count: 4 },
    { id: "footnote_@03", source_type: SOURCE_FOOTNOTE, marker: "03", count: 1 },
  ];
  const mapped = buildDefaultStreamMapping(sources);
  const letters = mapped.map(s => s.series);
  ok("multi-footnote distinct letters",
    new Set(letters).size === letters.length, letters.join(","));
}

// === streamsToSd / findDuplicateSeries ===
{
  const sources = [
    { id: "footnote_@01", source_type: SOURCE_FOOTNOTE, marker: "01", count: 5 },
  ];
  const mapped = buildDefaultStreamMapping(sources);
  const sd = streamsToSd(mapped);
  ok("streamsToSd has key", Object.keys(sd).length === 1);
  const sid = Object.keys(sd)[0];
  ok("streamsToSd preserves series", sd[sid].series === "A");
  ok("streamsToSd preserves marker", sd[sid].marker === "01");
  ok("streamsToSd count starts at 0", sd[sid].count === 0);

  // duplicates
  mapped.push({ ...mapped[0], id: "x", marker: "99", series: "A", included: true });
  const dups = findDuplicateSeries(mapped);
  ok("findDuplicateSeries detects A", dups.includes("A"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
