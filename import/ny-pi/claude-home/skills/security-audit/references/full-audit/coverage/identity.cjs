const { hasOwn, PATH_FORBIDDEN_CHARACTER, hasVisibleProse, isSafeRelativePath } = require("../shared/safe-text.cjs");
const { MAX_TEXT_LENGTH, REF_FIELDS, AGENT_ID_PATTERN, WINDOWS_RESERVED_AGENT_ID } = require("./limits.cjs");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVisibleText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    hasVisibleProse(value);
}

function isCanonicalRef(value) {
  return isVisibleText(value, 1024) &&
    !PATH_FORBIDDEN_CHARACTER.test(value) &&
    value.normalize("NFC") === value;
}

function encodeCanonicalRef(value) {
  if (!isCanonicalRef(value)) throw new TypeError("invalid canonical reference");
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const unreserved =
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e;
    encoded += unreserved ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
}

function canonicalCoverageId(refs) {
  if (!isObject(refs)) throw new TypeError("canonical_refs must be an object");
  const fields = hasOwn(refs, "lifecycle") ? [...REF_FIELDS, "lifecycle"] : REF_FIELDS;
  if (Object.keys(refs).length !== fields.length || fields.some((field) => !hasOwn(refs, field))) {
    throw new TypeError("canonical_refs has missing or unexpected fields");
  }
  return fields.map((field) => encodeCanonicalRef(refs[field])).join("::");
}

function isSafeAgentId(value) {
  return typeof value === "string" &&
    AGENT_ID_PATTERN.test(value) &&
    !WINDOWS_RESERVED_AGENT_ID.test(value);
}

function isOwnedArtifactPath(value, agentId) {
  if (!isSafeAgentId(agentId) || !isSafeRelativePath(value)) return false;
  const prefix = `agents/${agentId}/artifacts/`;
  return value.startsWith(prefix) && value.length > prefix.length;
}

function semanticKey(unit) {
  return JSON.stringify([
    unit.surface,
    unit.boundary,
    unit.subsystem,
    unit.attack_class,
    hasOwn(unit, "lifecycle") ? unit.lifecycle : null,
  ]);
}

function hasValidSemanticFields(unit) {
  return ["surface", "boundary", "subsystem", "attack_class"].every((field) => isVisibleText(unit[field])) &&
    (!hasOwn(unit, "lifecycle") || isVisibleText(unit.lifecycle));
}


module.exports = { isObject, isVisibleText, isCanonicalRef, encodeCanonicalRef, canonicalCoverageId, isSafeAgentId, isOwnedArtifactPath, semanticKey, hasValidSemanticFields };
