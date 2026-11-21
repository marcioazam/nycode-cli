const { createBoundedErrors } = require("../shared/safe-text.cjs");
const { LIMITS, MAX_UNITS, MAX_LIST_ITEMS } = require("./limits.cjs");
const createErrorList = () => createBoundedErrors(LIMITS.validationErrors);
const { JsonStructureError } = require("../shared/safe-input.cjs");

function preflightJsonText(contents) {
  const containers = [];
  let rootState = "value";
  let inString = false;
  let escaped = false;
  let totalValues = 0;

  function fail(message) {
    throw new JsonStructureError(`input ${message}`);
  }

  function currentContainer() {
    return containers[containers.length - 1];
  }

  function countValue() {
    totalValues++;
    if (totalValues > LIMITS.preflightValues) {
      fail(`exceeds ${LIMITS.preflightValues} total value limit`);
    }
  }

  function beginValue() {
    const container = currentContainer();
    if (!container) {
      if (rootState !== "value") fail("has malformed JSON structure");
      rootState = "end";
    } else if (container.type === "array") {
      if (container.state !== "firstValueOrEnd" && container.state !== "value") {
        fail("has malformed JSON array structure");
      }
      container.items++;
      const limit = container.topLevel ? MAX_UNITS : LIMITS.collectionItems;
      if (container.items > limit) {
        fail(container.topLevel
          ? `exceeds ${limit} top-level unit limit`
          : `exceeds ${limit} item array limit`);
      }
      container.state = "commaOrEnd";
    } else {
      if (container.state !== "value") fail("has malformed JSON object structure");
      container.state = "commaOrEnd";
    }
    countValue();
  }

  function beginString() {
    const container = currentContainer();
    if (container && container.type === "object" &&
        (container.state === "firstKeyOrEnd" || container.state === "key")) {
      container.fields++;
      if (container.fields > LIMITS.objectFields) {
        fail(`exceeds ${LIMITS.objectFields} field object limit`);
      }
      container.state = "colon";
    } else {
      beginValue();
    }
    inString = true;
  }

  function beginContainer(type) {
    beginValue();
    if (containers.length >= LIMITS.nestingDepth) {
      fail(`exceeds nesting depth limit ${LIMITS.nestingDepth}`);
    }
    containers.push(type === "array"
      ? { type, state: "firstValueOrEnd", items: 0, topLevel: containers.length === 0 }
      : { type, state: "firstKeyOrEnd", fields: 0 });
  }

  function closeContainer(type) {
    const container = currentContainer();
    if (!container || container.type !== type) fail("has mismatched JSON containers");
    const canClose = type === "array"
      ? container.state === "firstValueOrEnd" || container.state === "commaOrEnd"
      : container.state === "firstKeyOrEnd" || container.state === "commaOrEnd";
    if (!canClose) fail(`has malformed JSON ${type} structure`);
    containers.pop();
  }

  function isWhitespace(character) {
    return character === " " || character === "\t" || character === "\r" || character === "\n";
  }

  function isTokenDelimiter(character) {
    return isWhitespace(character) || character === "," || character === ":" ||
      character === "[" || character === "]" || character === "{" ||
      character === "}" || character === "\"";
  }

  for (let index = 0; index < contents.length; index++) {
    const character = contents[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (isWhitespace(character)) continue;

    if (character === "\"") {
      beginString();
    } else if (character === "[") {
      beginContainer("array");
    } else if (character === "{") {
      beginContainer("object");
    } else if (character === "]") {
      closeContainer("array");
    } else if (character === "}") {
      closeContainer("object");
    } else if (character === ":") {
      const container = currentContainer();
      if (!container || container.type !== "object" || container.state !== "colon") {
        fail("has malformed JSON object structure");
      }
      container.state = "value";
    } else if (character === ",") {
      const container = currentContainer();
      if (!container || container.state !== "commaOrEnd") fail("has malformed JSON collection structure");
      container.state = container.type === "array" ? "value" : "key";
    } else {
      beginValue();
      while (index + 1 < contents.length && !isTokenDelimiter(contents[index + 1])) index++;
    }
  }

  if (inString) fail("has an unterminated JSON string");
  if (containers.length > 0) fail("has truncated JSON structure");
  if (rootState !== "end") fail("has no JSON value");
}

function preflightDocument(root) {
  const errors = createErrorList();
  const stack = [{ value: root, depth: 0, location: "$" }];
  let visited = 0;

  while (stack.length > 0) {
    const { value, depth, location } = stack.pop();
    visited++;
    if (visited > LIMITS.preflightValues) {
      errors.push(`$: exceeds ${LIMITS.preflightValues} total values`);
      return errors;
    }
    if (value === null || typeof value !== "object") continue;
    if (depth >= LIMITS.nestingDepth) {
      errors.push(`${location}: exceeds nesting depth limit ${LIMITS.nestingDepth}`);
      return errors;
    }

    if (Array.isArray(value)) {
      const limit = location === "$" ? MAX_UNITS : MAX_LIST_ITEMS;
      if (value.length > limit) {
        errors.push(`${location}: exceeds ${limit} entries`);
        return errors;
      }
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ value: value[index], depth: depth + 1, location: `${location}[${index}]` });
      }
      continue;
    }

    const keys = Object.keys(value);
    if (keys.length > LIMITS.objectFields) {
      errors.push(`${location}: exceeds ${LIMITS.objectFields} object fields`);
      return errors;
    }
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      stack.push({ value: value[key], depth: depth + 1, location: `${location}{${index}}` });
    }
  }

  return errors;
}


module.exports = { preflightJsonText, preflightDocument };
