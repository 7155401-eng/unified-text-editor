// Experimental acceptance checks, not a layout engine. Coordinates are CSS px.
// Passing a structural check is deliberately NOT approval for production use.
export function analyzeLastRow({hostLeft, hostRight, opening, row, tolerance = 0.65}) {
  const values = [hostLeft, hostRight, opening?.left, opening?.right, row?.left, row?.right];
  if (!values.every(Number.isFinite) || hostRight <= hostLeft || row.right < row.left) {
    return {valid: false, reason: 'UNMEASURABLE'};
  }
  const hostCenter = (hostLeft + hostRight) / 2;
  const envelopeCenter = (Math.min(row.left, opening.left) + Math.max(row.right, opening.right)) / 2;
  const bodyWidth = row.right - row.left;
  const freeRight = opening.left - (opening.gap || 0);
  const freeCenter = (hostLeft + freeRight) / 2;
  const spare = freeRight - hostLeft - bodyWidth;
  const bodyPinnedToLeft = spare > tolerance * 2 && row.left <= hostLeft + tolerance;
  const centeredEnvelope = Math.abs(envelopeCenter - hostCenter) <= tolerance;
  const openingAtHostRight = Math.abs(opening.right - hostRight) <= tolerance;
  const unclipped = row.left >= hostLeft - tolerance && row.right <= freeRight + tolerance;
  return {valid: true, hostCenter, envelopeCenter, bodyCenter: (row.left + row.right) / 2,
    freeCenter, spare, centeredEnvelope, bodyPinnedToLeft, openingAtHostRight, unclipped,
    // A fixed right-edge opening + composite centering fixes the left envelope
    // edge at hostLeft. Moving only the body cannot also leave a left inset.
    fixedEdgeConflict: openingAtHostRight && spare > tolerance * 2,
    meetsReportedCentering: centeredEnvelope && !bodyPinnedToLeft && unclipped};
}

export function nativeEligibility({sourcePreserved, inputUnchanged, oneParagraph,
  flowPositioned, typographyPreserved, rowFit, noSpaceBreaks, centeredOpeningTail,
  geometrySufficient = true, policySupported = true}) {
  const reasons = [];
  for (const [name, ok] of Object.entries({sourcePreserved, inputUnchanged, oneParagraph,
    flowPositioned, typographyPreserved, rowFit, noSpaceBreaks, geometrySufficient, policySupported})) {
    if (ok !== true) reasons.push(name);
  }
  if (centeredOpeningTail && !centeredOpeningTail.meetsReportedCentering) reasons.push('combined-final-line-centering');
  return {localContractsPass: reasons.length === 0, reasons,
    productionEligible: false,
    pending: ['full-V9-pagination', 'note-anchor-page-ownership', 'crown-and-knee-layout',
      'user-document-acceptance', 'user-fonts-and-browser', 'visual-equivalence']};
}
