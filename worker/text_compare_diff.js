/*
 * Minimal Worker-side character diff adapter for Text Compare Pro.
 * It mirrors the jsdiff character output shape used by the browser vendor.
 */

class CharDiff {
  diff(oldStr, newStr) {
    const oldChars = String(oldStr || "").split("");
    const newChars = String(newStr || "").split("");
    const maxEditLength = oldChars.length + newChars.length;
    const bestPath = [{ newPos: -1, components: [] }];
    let oldPos = this.extractCommon(bestPath[0], newChars, oldChars, 0);

    if (bestPath[0].newPos + 1 >= newChars.length && oldPos + 1 >= oldChars.length) {
      return [{ value: newChars.join("") }];
    }

    for (let editLength = 1; editLength <= maxEditLength; editLength++) {
      for (let diagonal = -editLength; diagonal <= editLength; diagonal += 2) {
        let basePath;
        const addPath = bestPath[diagonal - 1];
        const removePath = bestPath[diagonal + 1];
        const oldPosFromRemove = (removePath ? removePath.newPos : 0) - diagonal;

        if (addPath) bestPath[diagonal - 1] = undefined;

        const canAdd = addPath && addPath.newPos + 1 < newChars.length;
        const canRemove = removePath && oldPosFromRemove >= 0 && oldPosFromRemove < oldChars.length;
        if (!canAdd && !canRemove) {
          bestPath[diagonal] = undefined;
          continue;
        }

        if (!canAdd || (canRemove && addPath.newPos < removePath.newPos)) {
          basePath = {
            newPos: removePath.newPos,
            components: removePath.components.slice(0),
          };
          this.pushComponent(basePath.components, false, true);
        } else {
          basePath = addPath;
          basePath.newPos++;
          this.pushComponent(basePath.components, true, false);
        }

        oldPos = this.extractCommon(basePath, newChars, oldChars, diagonal);
        if (basePath.newPos + 1 >= newChars.length && oldPos + 1 >= oldChars.length) {
          return this.buildValues(basePath.components, newChars, oldChars);
        }

        bestPath[diagonal] = basePath;
      }
    }

    return [{ value: newStr }];
  }

  pushComponent(components, added, removed) {
    const last = components[components.length - 1];
    if (last && last.added === added && last.removed === removed) {
      last.count++;
    } else {
      components.push({ count: 1, added, removed });
    }
  }

  extractCommon(basePath, newChars, oldChars, diagonal) {
    const newLen = newChars.length;
    const oldLen = oldChars.length;
    let newPos = basePath.newPos;
    let oldPos = newPos - diagonal;
    let commonCount = 0;

    while (newPos + 1 < newLen && oldPos + 1 < oldLen && newChars[newPos + 1] === oldChars[oldPos + 1]) {
      newPos++;
      oldPos++;
      commonCount++;
    }

    if (commonCount) basePath.components.push({ count: commonCount });
    basePath.newPos = newPos;
    return oldPos;
  }

  buildValues(components, newChars, oldChars) {
    let newPos = 0;
    let oldPos = 0;
    const result = components.map((component) => {
      const out = { ...component };
      if (component.removed) {
        out.value = oldChars.slice(oldPos, oldPos + component.count).join("");
        oldPos += component.count;
      } else {
        out.value = newChars.slice(newPos, newPos + component.count).join("");
        newPos += component.count;
        if (!component.added) oldPos += component.count;
      }
      delete out.count;
      if (!out.added) delete out.added;
      if (!out.removed) delete out.removed;
      return out;
    });

    const last = result[result.length - 1];
    if (
      result.length > 1 &&
      last &&
      typeof last.value === "string" &&
      (last.added || last.removed) &&
      last.value === ""
    ) {
      result[result.length - 2].value += last.value;
      result.pop();
    }
    return result;
  }
}

const charDiff = new CharDiff();

export function diffChars(oldStr, newStr) {
  return charDiff.diff(oldStr, newStr);
}
