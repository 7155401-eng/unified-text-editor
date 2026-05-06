// sample_matrix.mjs — runs verify-16-rules + verify-content-integrity
// across multiple samples and reports a summary matrix.
//
// Usage:
//   node test-harness/sample_matrix.mjs [URL]

import { spawn } from "child_process";

const URL = process.argv[2] || process.env.URL || "http://localhost:5189/unified-text-editor/";
const SAMPLES = (process.env.SAMPLES || "shulchan,talmud").split(",");

function run(cmd, args, label) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", d => { stdout += d.toString(); });
    p.stderr.on("data", d => { stderr += d.toString(); });
    p.on("close", code => {
      resolve({ label, code, stdout, stderr });
    });
  });
}

console.log(`\n=== SAMPLE MATRIX ===`);
console.log(`URL: ${URL}`);
console.log(`Samples: ${SAMPLES.join(", ")}`);

const results = [];
for (const sample of SAMPLES) {
  console.log(`\n--- Sample: ${sample} ---`);

  const rules = await run("node", ["verify-16-rules.mjs", URL, "--sample", sample], `${sample}-rules`);
  // Extract summary line from rules output
  const rulesSummary = rules.stdout.match(/Total page-rule failures: (\d+)/);
  console.log(`  16-rules: exit=${rules.code} ${rulesSummary ? `(${rulesSummary[1]} failures)` : ""}`);

  const integrity = await run("node", ["verify-content-integrity.mjs", URL, "--sample", sample], `${sample}-integrity`);
  const lostMatch = integrity.stdout.match(/Words lost \(in A, missing from B\): (\d+)/);
  console.log(`  integrity: exit=${integrity.code} ${lostMatch ? `(${lostMatch[1]} lost)` : ""}`);

  results.push({
    sample,
    rulesExit: rules.code,
    rulesFailures: rulesSummary ? parseInt(rulesSummary[1], 10) : -1,
    integrityExit: integrity.code,
    wordsLost: lostMatch ? parseInt(lostMatch[1], 10) : -1,
  });
}

console.log(`\n=== MATRIX SUMMARY ===`);
console.log(`┌────────────┬──────────────┬───────────────┐`);
console.log(`│ Sample     │ Rule failures│ Words lost    │`);
console.log(`├────────────┼──────────────┼───────────────┤`);
for (const r of results) {
  const sample = r.sample.padEnd(10);
  const rf = String(r.rulesFailures).padStart(13);
  const wl = String(r.wordsLost).padStart(14);
  console.log(`│ ${sample} │${rf} │${wl} │`);
}
console.log(`└────────────┴──────────────┴───────────────┘`);

const allOk = results.every(r => r.rulesFailures === 0 && r.wordsLost === 0);
process.exit(allOk ? 0 : 1);
