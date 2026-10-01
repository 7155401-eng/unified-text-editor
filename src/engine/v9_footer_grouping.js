function secondaryLevelIndex(streamId, levels, mishnaWrapOn, firstFooterLevel = 1) {
  if (!mishnaWrapOn || !Array.isArray(levels)) return -1;
  for (let i = firstFooterLevel; i < levels.length; i++) {
    if ((levels[i] || []).map(String).includes(String(streamId))) return i;
  }
  return -1;
}

/**
 * Group V9 footer streams without ever reallocating the two fixed Talmud sides.
 *
 * Secondary global Mishnah levels keep their historic grouping. In addition,
 * exactly two footer streams explicitly configured with layoutRole="mishna"
 * form one Mishnah flow pair. This restores the supported mixed document shape:
 * two fixed Talmud streams + two Mishnah Berura streams below them.
 */
export function groupV9FooterStreams(streams = [], streamSettings = {}, levels = [], mishnaWrapOn = false, fixedSideStreams = []) {
  const list = Array.isArray(streams) ? streams.filter(Boolean) : [];
  // The "other streams" control stores footer-only levels (e.g. "03,04").
  // Level zero is reserved for sides only when sides are selected from levels.
  // With explicitly owned sides, admit a disjoint first footer level as well;
  // never infer that ownership from whichever streams happen to have text.
  const fixedSides = new Set((Array.isArray(fixedSideStreams) ? fixedSideStreams.slice(0, 2) : [])
    .filter(id => id != null && String(id).trim()).map(String));
  const firstFooterLevel = fixedSides.size && Array.isArray(levels?.[0]) && levels[0].length &&
    levels[0].every(id => !fixedSides.has(String(id))) ? 0 : 1;
  const explicitMishna = list.filter((fs) =>
    secondaryLevelIndex(fs?.id, levels, mishnaWrapOn, firstFooterLevel) < 0 &&
    String(streamSettings?.[fs?.id]?.layoutRole || "") === "mishna"
  );
  const pairExplicitMishna = explicitMishna.length === 2;

  const groups = [];
  const keyed = new Map();

  const addKeyed = (key, spec, stream) => {
    if (!keyed.has(key)) {
      const group = { ...spec, streams: [] };
      keyed.set(key, group);
      groups.push(group);
    }
    keyed.get(key).streams.push(stream);
  };

  for (const fs of list) {
    const level = secondaryLevelIndex(fs.id, levels, mishnaWrapOn, firstFooterLevel);
    if (level >= firstFooterLevel) {
      addKeyed(`level:${level}`, {
        level,
        mishnaFlow: true,
        source: "levels",
      }, fs);
      continue;
    }

    if (pairExplicitMishna && String(streamSettings?.[fs.id]?.layoutRole || "") === "mishna") {
      addKeyed("layout-role:mishna", {
        level: -1,
        mishnaFlow: true,
        source: "layoutRole",
      }, fs);
      continue;
    }

    groups.push({
      level: -1,
      mishnaFlow: false,
      source: "normal",
      streams: [fs],
    });
  }

  return groups;
}
