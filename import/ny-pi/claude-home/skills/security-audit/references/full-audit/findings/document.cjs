const fs = require("node:fs");
const { LIMITS, collectDataLimitErrors } = require("./limits.cjs");
const { collectSchemaErrors, collectUnchecked } = require("./schema.cjs");
const { collectFindingSemanticErrors } = require("./semantics.cjs");

function validateDocument(findings, schema) {
  const schemaErrors = collectSchemaErrors(schema);
  if (schemaErrors.length > 0) return schemaErrors;
  const limitErrors = collectDataLimitErrors(findings, "$");
  if (limitErrors.length > 0) return limitErrors;
  const errors = collectUnchecked(findings, schema, "$");
  if (errors.length < LIMITS.validationErrors) {
    errors.push(...collectFindingSemanticErrors(findings));
  }
  return errors;
}

function loadSchema(schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const errors = collectSchemaErrors(schema);
  if (errors.length > 0) throw new Error(`unsupported or invalid report schema:\n${errors.join("\n")}`);
  return schema;
}


module.exports = { validateDocument, loadSchema };
