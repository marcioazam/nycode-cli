import type { PathPlaceholders } from "./types";

const PLACEHOLDER_PATTERN = /\{(workspace|root|file|relFile|dir|relDir|config|configDir)\}/g;

export function applyTemplate(input: string, values: PathPlaceholders): string {
  return input.replace(PLACEHOLDER_PATTERN, (_match, key: keyof PathPlaceholders) => values[key] ?? "");
}

export function applyTemplateArray(inputs: string[] | undefined, values: PathPlaceholders): string[] {
  return (inputs ?? []).map((input) => applyTemplate(input, values));
}

export function applyTemplateRecord(
  inputs: Record<string, string> | undefined,
  values: PathPlaceholders,
): Record<string, string> | undefined {
  if (!inputs) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    out[key] = applyTemplate(value, values);
  }
  return out;
}
