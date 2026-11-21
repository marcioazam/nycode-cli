import { compare, valid } from "semver";
import { fetchWithRetry } from "./management-http.ts";
import { getNycodeUserAgent } from "./nycode-user-agent.ts";

export const RELEASES_URL = "https://github.com/marcioazam/nycode/releases";
const LATEST_RELEASE_API_URL = "https://api.github.com/repos/marcioazam/nycode/releases/latest";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestNycodeRelease {
	version: string;
}

/** Include useful errno details hidden behind Node's generic "fetch failed" error. */
export function formatVersionCheckError(error: unknown): string {
	const rootMessage = error instanceof Error && error.message ? error.message : String(error);
	const cause = error instanceof Error ? error.cause : undefined;
	const causes = cause instanceof AggregateError ? cause.errors : cause === undefined ? [] : [cause];
	const codes = causes
		.map((value) =>
			typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
				? value.code
				: undefined,
		)
		.filter((code): code is string => code !== undefined);

	if (codes.length > 0) return `${rootMessage} (${[...new Set(codes)].join(", ")})`;
	const causeMessage = causes.find(
		(value): value is Error => value instanceof Error && Boolean(value.message),
	)?.message;
	return causeMessage ? `${rootMessage} (cause: ${causeMessage})` : rootMessage;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestNycodeRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<LatestNycodeRelease | undefined> {
	if (process.env.NYCODE_OFFLINE) return undefined;

	const response = await fetchWithRetry(
		LATEST_RELEASE_API_URL,
		{
			headers: {
				"User-Agent": getNycodeUserAgent(currentVersion),
				accept: "application/vnd.github+json",
			},
		},
		{
			maxRetries: options.retry ? 2 : 0,
			timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
		},
	);
	if (!response.ok) return undefined;

	// The release tag is the version; `v0.1.0` and `0.1.0` both name 0.1.0.
	const data = (await response.json()) as { tag_name?: unknown };
	const version = typeof data.tag_name === "string" ? data.tag_name.trim().replace(/^v/, "") : "";
	return version ? { version } : undefined;
}

export async function getLatestNycodeVersion(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<string | undefined> {
	return (await getLatestNycodeRelease(currentVersion, options))?.version;
}

export async function checkForNewNycodeVersion(currentVersion: string): Promise<LatestNycodeRelease | undefined> {
	if (process.env.NYCODE_SKIP_VERSION_CHECK) return undefined;

	try {
		const latestRelease = await getLatestNycodeRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
