function secondaryLevelIndex(streamId, levels, mishnaWrapOn) {
  if (!mishnaWrapOn || !Array.isArray(levels)) return -1;
  for (let i = 1; i < levels.length; i++) {
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
export function groupV9FooterStreams(streams = [], streamSettings = {}, levels = [], mishnaWrapOn = false) {
  const list = Array.isArray(streams) ? streams.filter(Boolean) : [];
  const explicitMishna = list.filter((fs) =>
    secondaryLevelIndex(fs?.id, levels, mishnaWrapOn) < 0 &&
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
    const level = secondaryLevelIndex(fs.id, levels, mishnaWrapOn);
    if (level >= 1) {
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
