const { hasOwn, VISIBLE_CONTENT, safeQuote, propertyPath, createBoundedErrors, hasValidUnicodeScalarValues } = require("../shared/safe-text.cjs");
const { LIMITS } = require("./limits.cjs");
const createErrorList = () => createBoundedErrors(LIMITS.validationErrors);
const { collectDataLimitErrors } = require("./limits.cjs");

const SUPPORTED_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);
const SUPPORTED_KEYWORDS = new Set([
  "$comment",
  "additionalProperties",
  "const",
  "description",
  "enum",
  "items",
  "minimum",
  "minItems",
  "minLength",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "type",
  "uniqueItems",
  "visibleContent",
]);
function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeOf(left) !== typeOf(right)) return false;
  if (Array.isArray(left)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (left !== null && typeof left === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

function codePointLength(value) {
  let length = 0;
  let index = 0;
  while (index < value.length) {
    const first = value.charCodeAt(index++);
    if (first >= 0xd800 && first <= 0xdbff && index < value.length) {
      const second = value.charCodeAt(index);
      if (second >= 0xdc00 && second <= 0xdfff) index++;
    }
    length++;
  }
  return length;
}

function canonicalKey(value) {
  const chunks = [];
  let bytes = 0;

  function append(chunk) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > LIMITS.canonicalKeyBytes) {
      throw new Error(`canonical key exceeds ${LIMITS.canonicalKeyBytes} byte limit`);
    }
    chunks.push(chunk);
  }

  function encode(item) {
    const type = typeOf(item);
    if (type === "null") {
      append("null");
    } else if (type === "string") {
      append(`string:${JSON.stringify(item)}`);
    } else if (type === "number") {
      append(`number:${Object.is(item, -0) ? "0" : String(item)}`);
    } else if (type === "boolean") {
      append(`boolean:${item ? "true" : "false"}`);
    } else if (type === "array") {
      append("array:[");
      item.forEach((entry, index) => {
        if (index > 0) append(",");
        encode(entry);
      });
      append("]");
    } else if (type === "object") {
      append("object:{");
      Object.keys(item).sort().forEach((key, index) => {
        if (index > 0) append(",");
        append(JSON.stringify(key));
        append(":");
        encode(item[key]);
      });
      append("}");
    } else {
      append(`${type}:${String(item)}`);
    }
  }

  encode(value);
  return { key: chunks.join(""), bytes };
}

function collectSchemaErrors(schema, location = "schema") {
  const errors = createErrorList();

  function check(node, p) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`${p}: schema must be an object`);
      return;
    }

    for (const key of Object.keys(node)) {
      if (!SUPPORTED_KEYWORDS.has(key)) errors.push(`${p}: unsupported schema keyword ${safeQuote(key)}`);
    }

    if (hasOwn(node, "$comment") && typeof node.$comment !== "string") {
      errors.push(`${p}.$comment: expected string`);
    }
    if (hasOwn(node, "description") && typeof node.description !== "string") {
      errors.push(`${p}.description: expected string`);
    }
    if (hasOwn(node, "type") && (!SUPPORTED_TYPES.has(node.type))) {
      errors.push(`${p}.type: unsupported type ${safeQuote(node.type)}`);
    }
    if (hasOwn(node, "properties")) {
      if (node.properties === null || typeof node.properties !== "object" || Array.isArray(node.properties)) {
        errors.push(`${p}.properties: expected object`);
      } else {
        for (const key of Object.keys(node.properties)) check(node.properties[key], propertyPath(`${p}.properties`, key));
      }
    }
    if (hasOwn(node, "required")) {
      if (!Array.isArray(node.required) || node.required.some((key) => typeof key !== "string")) {
        errors.push(`${p}.required: expected an array of strings`);
      } else if (new Set(node.required).size !== node.required.length) {
        errors.push(`${p}.required: entries must be unique`);
      }
    }
    if (hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") {
      errors.push(`${p}.additionalProperties: only boolean values are supported`);
    }
    if (hasOwn(node, "enum")) {
      if (!Array.isArray(node.enum) || node.enum.length === 0) {
        errors.push(`${p}.enum: expected a non-empty array`);
      } else {
        const seen = new Set();
        for (const value of node.enum) {
          let key;
          try {
            key = canonicalKey(value).key;
          } catch (error) {
            errors.push(`${p}.enum: ${error.message}`);
            break;
          }
          if (seen.has(key)) {
            errors.push(`${p}.enum: entries must be unique`);
            break;
          }
          seen.add(key);
        }
      }
    }
    if (hasOwn(node, "items")) check(node.items, `${p}.items`);
    for (const keyword of ["minItems", "minLength"]) {
      if (hasOwn(node, keyword) && (!Number.isInteger(node[keyword]) || node[keyword] < 0)) {
        errors.push(`${p}.${keyword}: expected a non-negative integer`);
      }
    }
    if (hasOwn(node, "minimum") && (typeof node.minimum !== "number" || !Number.isFinite(node.minimum))) {
      errors.push(`${p}.minimum: expected a finite number`);
    }
    if (hasOwn(node, "pattern")) {
      if (typeof node.pattern !== "string") {
        errors.push(`${p}.pattern: expected string`);
      } else {
        try {
          new RegExp(node.pattern);
        } catch (error) {
          errors.push(`${p}.pattern: invalid regular expression`);
        }
      }
    }
    if (hasOwn(node, "uniqueItems") && typeof node.uniqueItems !== "boolean") {
      errors.push(`${p}.uniqueItems: expected boolean`);
    }
    if (hasOwn(node, "visibleContent")) {
      if (typeof node.visibleContent !== "boolean") {
        errors.push(`${p}.visibleContent: expected boolean`);
      } else if (node.visibleContent === true && node.type !== "string") {
        errors.push(`${p}.visibleContent: requires type "string"`);
      }
    }
    if (hasOwn(node, "oneOf")) {
      if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) {
        errors.push(`${p}.oneOf: expected a non-empty array`);
      } else {
        node.oneOf.forEach((branch, index) => check(branch, `${p}.oneOf[${index}]`));
      }
    }
  }

  check(schema, location);
  return errors;
}

function findDiscriminator(schema) {
  if (!hasOwn(schema, "properties") || typeof schema.properties !== "object") return null;
  for (const key of Object.keys(schema.properties)) {
    const subSchema = schema.properties[key];
    if (subSchema && typeof subSchema === "object" && hasOwn(subSchema, "const")) {
      return { key, value: subSchema.const };
    }
  }
  return null;
}

function validate(value, schema, p, errors) {
  if (errors.length >= LIMITS.validationErrors) return;
  if (hasOwn(schema, "oneOf")) {
    const results = schema.oneOf.map((branch) => collectUnchecked(value, branch, p));
    const passingIndexes = results
      .map((branchErrors, index) => branchErrors.length === 0 ? index : -1)
      .filter((index) => index !== -1);

    if (passingIndexes.length !== 1) {
      errors.push(`${p}: must match exactly one schema in oneOf; matched ${passingIndexes.length}`);
      if (passingIndexes.length === 0 && value !== null && typeof value === "object" && !Array.isArray(value)) {
        const matchingDiscriminators = schema.oneOf
          .map((branch, index) => ({ discriminator: findDiscriminator(branch), index }))
          .filter(({ discriminator }) => discriminator && hasOwn(value, discriminator.key) && deepEqual(value[discriminator.key], discriminator.value));
        if (matchingDiscriminators.length === 1) {
          errors.push(...results[matchingDiscriminators[0].index]);
        }
      }
    }
  }

  if (hasOwn(schema, "const") && !deepEqual(value, schema.const)) {
    errors.push(`${p}: must equal ${safeQuote(schema.const)}, got ${safeQuote(value)}`);
  }
  if (hasOwn(schema, "enum") && !schema.enum.some((allowed) => deepEqual(value, allowed))) {
    const allowed = schema.enum.map(safeQuote).join(", ");
    errors.push(`${p}: invalid value ${safeQuote(value)} (expected one of ${allowed})`);
  }

  if (hasOwn(schema, "type") && typeOf(value) !== schema.type && !(schema.type === "integer" && typeOf(value) === "number" && Number.isInteger(value))) {
    errors.push(`${p}: expected ${schema.type}, got ${typeOf(value)}`);
    return;
  }

  if (typeOf(value) === "object") {
    for (const req of hasOwn(schema, "required") ? schema.required : []) {
      if (!hasOwn(value, req)) errors.push(`${p}: missing required field ${safeQuote(req)}`);
    }
    for (const key of Object.keys(value)) {
      if (hasOwn(schema, "properties") && hasOwn(schema.properties, key)) {
        validate(value[key], schema.properties[key], propertyPath(p, key), errors);
      } else if (hasOwn(schema, "additionalProperties") && schema.additionalProperties === false) {
        errors.push(`${p}: unexpected field ${safeQuote(key)}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (hasOwn(schema, "minItems") && value.length < schema.minItems) {
      errors.push(`${p}: must have at least ${schema.minItems} item(s), got ${value.length}`);
    }
    if (hasOwn(schema, "uniqueItems") && schema.uniqueItems === true) {
      const seen = new Set();
      let setBytes = 0;
      for (let i = 0; i < value.length; i++) {
        let canonical;
        try {
          canonical = canonicalKey(value[i]);
        } catch (error) {
          errors.push(`${p}[${i}]: ${error.message}`);
          break;
        }
        if (seen.has(canonical.key)) {
          errors.push(`${p}: items must be unique; duplicate at index ${i}`);
          continue;
        }
        setBytes += canonical.bytes;
        if (setBytes > LIMITS.uniqueSetBytes) {
          errors.push(`${p}: canonical uniqueness set exceeds ${LIMITS.uniqueSetBytes} byte limit`);
          break;
        }
        seen.add(canonical.key);
      }
    }
    if (hasOwn(schema, "items")) {
      value.forEach((item, index) => validate(item, schema.items, `${p}[${index}]`, errors));
    }
  }

  if (typeof value === "string") {
    if (hasOwn(schema, "minLength") && codePointLength(value) < schema.minLength) {
      errors.push(`${p}: must have at least ${schema.minLength} character(s)`);
    }
    if (schema.visibleContent === true) {
      if (!hasValidUnicodeScalarValues(value)) {
        errors.push(`${p}: must contain only valid Unicode scalar values`);
      } else if (!VISIBLE_CONTENT.test(value)) {
        errors.push(`${p}: must contain a visible character`);
      }
    }
    if (hasOwn(schema, "pattern") && !(new RegExp(schema.pattern).test(value))) {
      errors.push(`${p}: must match pattern ${JSON.stringify(schema.pattern)}`);
    }
  }

  if (typeof value === "number" && hasOwn(schema, "minimum") && value < schema.minimum) {
    errors.push(`${p}: must be at least ${schema.minimum}, got ${value}`);
  }
}

function collectUnchecked(value, schema, p) {
  const errors = createErrorList();
  validate(value, schema, p, errors);
  return errors;
}

function collect(value, schema, p = "$data") {
  const limitErrors = collectDataLimitErrors(value, p);
  if (limitErrors.length > 0) return limitErrors;
  return collectUnchecked(value, schema, p);
}


module.exports = { collectSchemaErrors, collectUnchecked, collect };
