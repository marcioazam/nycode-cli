const { hasOwn, safeQuote, createBoundedErrors, hasVisibleProse, isSafeRelativePath } = require("../shared/safe-text.cjs");
const { LIMITS } = require("./limits.cjs");
const createErrorList = () => createBoundedErrors(LIMITS.validationErrors);
const isSafeRelativeSourcePath = isSafeRelativePath;

const SEVERITY_RANK = new Map([
  ["informational", 0],
  ["low", 1],
  ["medium", 2],
  ["high", 3],
  ["critical", 4],
]);
function collectFindingSemanticErrors(findings) {
  const errors = createErrorList();
  if (!Array.isArray(findings)) return errors;

  const fingerprints = new Map();
  let previousFingerprint = null;
  findings.forEach((finding, index) => {
    if (errors.length >= LIMITS.validationErrors) return;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) return;
    const base = `$[${index}]`;

    if (hasOwn(finding, "fingerprint") && typeof finding.fingerprint === "string") {
      if (fingerprints.has(finding.fingerprint)) {
        errors.push(`${base}.fingerprint: duplicate of $[${fingerprints.get(finding.fingerprint)}].fingerprint`);
      } else {
        fingerprints.set(finding.fingerprint, index);
      }
      if (previousFingerprint !== null && previousFingerprint > finding.fingerprint) {
        errors.push(`${base}.fingerprint: findings must be sorted lexicographically`);
      }
      previousFingerprint = finding.fingerprint;
    }

    for (const field of ["trace", "evidence"]) {
      if (!hasOwn(finding, field) || !Array.isArray(finding[field])) continue;
      finding[field].forEach((entry, entryIndex) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
        if (hasOwn(entry, "line") && (!Number.isInteger(entry.line) || entry.line < 1)) {
          errors.push(`${base}.${field}[${entryIndex}].line: must be a positive integer`);
        }
        if (hasOwn(entry, "file") && !isSafeRelativeSourcePath(entry.file)) {
          errors.push(`${base}.${field}[${entryIndex}].file: must be a safe repository-relative source path`);
        }
      });
    }
    if (finding.remediation && Array.isArray(finding.remediation.code_changes)) {
      finding.remediation.code_changes.forEach((change, changeIndex) => {
        if (change && hasOwn(change, "file_name") && !isSafeRelativeSourcePath(change.file_name)) {
          errors.push(`${base}.remediation.code_changes[${changeIndex}].file_name: must be a safe repository-relative source path`);
        }
      });
    }

    if (Array.isArray(finding.trace) && finding.trace.length === 1) {
      const kind = finding.trace[0] && finding.trace[0].kind;
      if (kind !== "entrypoint" && kind !== "sink") {
        errors.push(`${base}.trace[0].kind: a one-line trace must be "entrypoint" or "sink"`);
      }
    } else if (Array.isArray(finding.trace) && finding.trace.length > 1) {
      const last = finding.trace.length - 1;
      if (finding.trace[0] && finding.trace[0].kind !== "entrypoint") {
        errors.push(`${base}.trace[0].kind: must be "entrypoint", got ${safeQuote(finding.trace[0].kind)}`);
      }
      if (finding.trace[last] && finding.trace[last].kind !== "sink") {
        errors.push(`${base}.trace[${last}].kind: must be "sink", got ${safeQuote(finding.trace[last].kind)}`);
      }
      for (let traceIndex = 1; traceIndex < last; traceIndex++) {
        if (finding.trace[traceIndex] && finding.trace[traceIndex].kind !== "propagation") {
          errors.push(`${base}.trace[${traceIndex}].kind: must be "propagation", got ${safeQuote(finding.trace[traceIndex].kind)}`);
        }
      }
    }

    const verdict = finding.verdict;
    if (verdict === "confirmed") {
      for (const forbidden of ["claimed_root_cause", "blockers", "validation_plan", "reason"]) {
        if (hasOwn(finding, forbidden)) errors.push(`${base}: confirmed finding must not contain ${safeQuote(forbidden)}`);
      }
      if (!finding.execution || typeof finding.execution !== "object" || typeof finding.execution.observed_result !== "string" || !hasVisibleProse(finding.execution.observed_result)) {
        errors.push(`${base}: confirmed finding requires a visible execution observed_result`);
      }
      if (!finding.remediation || typeof finding.remediation !== "object" || typeof finding.remediation.strategy !== "string" || !hasVisibleProse(finding.remediation.strategy)) {
        errors.push(`${base}: confirmed finding requires visible remediation`);
      }
      const overall = finding.severity && finding.severity.overall_severity;
      const impact = finding.severity && finding.severity.impact && finding.severity.impact.score;
      if (SEVERITY_RANK.has(overall) && SEVERITY_RANK.has(impact) && SEVERITY_RANK.get(overall) > SEVERITY_RANK.get(impact)) {
        errors.push(`${base}.severity.overall_severity: cannot exceed demonstrated impact ${safeQuote(impact)}`);
      }
    } else if (verdict === "needs_validation") {
      if (hasOwn(finding, "severity")) errors.push(`${base}: needs_validation finding must not contain "severity"`);
      for (const forbidden of ["execution", "remediation", "reason", "root_cause"]) {
        if (hasOwn(finding, forbidden)) errors.push(`${base}: needs_validation finding must not contain ${safeQuote(forbidden)}`);
      }
      const plan = finding.validation_plan;
      const hasLocalPlan = plan && typeof plan.local === "string" && hasVisibleProse(plan.local);
      const hasDeploymentPlan = plan && typeof plan.deployment === "string" && hasVisibleProse(plan.deployment);
      if (!hasLocalPlan && !hasDeploymentPlan) {
        errors.push(`${base}.validation_plan: requires at least one visible local or deployment plan`);
      }
    } else if (verdict === "rejected") {
      for (const forbidden of ["severity", "execution", "remediation", "blockers", "validation_plan", "root_cause"]) {
        if (hasOwn(finding, forbidden)) errors.push(`${base}: rejected finding must not contain ${safeQuote(forbidden)}`);
      }
    }
  });

  return errors;
}


module.exports = { collectFindingSemanticErrors, isSafeRelativeSourcePath };
