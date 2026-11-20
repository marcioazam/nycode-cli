import { formatUserAgent } from "@nycode/ai";

/** nycode's `User-Agent` for its own network requests; the same detailed form nycode-ai sends to providers. */
export function getNycodeUserAgent(version: string): string {
	return formatUserAgent({ userAgent: "detailed", version });
}
