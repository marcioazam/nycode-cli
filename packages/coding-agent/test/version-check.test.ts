import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	checkForNewNycodeVersion,
	comparePackageVersions,
	formatVersionCheckError,
	getLatestNycodeRelease,
	getLatestNycodeVersion,
	isNewerPackageVersion,
} from "../src/utils/version-check.ts";
import { allowNetwork } from "./test-network-env.ts";

const originalSkipVersionCheck = process.env.NYCODE_SKIP_VERSION_CHECK;

beforeEach(() => {
	allowNetwork();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	if (originalSkipVersionCheck === undefined) {
		delete process.env.NYCODE_SKIP_VERSION_CHECK;
	} else {
		process.env.NYCODE_SKIP_VERSION_CHECK = originalSkipVersionCheck;
	}
});

describe("version checks", () => {
	it("compares package versions", () => {
		expect(comparePackageVersions("0.70.6", "0.70.5")).toBeGreaterThan(0);
		expect(comparePackageVersions("0.70.5", "0.70.5")).toBe(0);
		expect(comparePackageVersions("0.70.4", "0.70.5")).toBeLessThan(0);
		expect(comparePackageVersions("5.0.0-beta.20", "5.0.0-beta.9")).toBeGreaterThan(0);
		expect(isNewerPackageVersion("0.70.5", "0.70.5")).toBe(false);
		expect(isNewerPackageVersion("0.70.6", "0.70.5")).toBe(true);
	});

	it("returns only newer versions", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.2.3" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewNycodeVersion("1.2.3")).resolves.toBeUndefined();
		await expect(checkForNewNycodeVersion("1.2.2")).resolves.toEqual({ version: "1.2.3" });
	});

	it("uses the GitHub Releases latest-release api of marcioazam/nycode with a nycode user agent", async () => {
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNycodeVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.github.com/repos/marcioazam/nycode/releases/latest",
			expect.objectContaining({
				headers: expect.objectContaining({
					"User-Agent": expect.stringMatching(/^nycode\/1\.2\.3 /),
					accept: "application/vnd.github+json",
				}),
			}),
		);
	});

	it("retries a transient version request when explicitly requested", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockRejectedValueOnce(new Error("fetch failed"))
			.mockResolvedValueOnce(Response.json({ tag_name: "v1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNycodeRelease("1.2.3", { retry: true })).resolves.toEqual({ version: "1.2.4" });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("keeps automatic version checks to one request", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewNycodeVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("formats nested network error details", () => {
		const error = new Error("fetch failed", {
			cause: new AggregateError([
				Object.assign(new Error("connect timeout"), { code: "ETIMEDOUT" }),
				Object.assign(new Error("network unreachable"), { code: "ENETUNREACH" }),
			]),
		});

		expect(formatVersionCheckError(error)).toBe("fetch failed (ETIMEDOUT, ENETUNREACH)");
	});

	it("reads the version from the release tag, with or without a leading v", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ tag_name: "1.2.4" })),
		);
		await expect(getLatestNycodeRelease("1.2.3")).resolves.toEqual({ version: "1.2.4" });
	});

	it("returns nothing for a release without a usable tag or a failed request", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ tag_name: " " })),
		);
		await expect(getLatestNycodeRelease("1.2.3")).resolves.toBeUndefined();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("rate limited", { status: 403 })),
		);
		await expect(getLatestNycodeRelease("1.2.3")).resolves.toBeUndefined();
	});

	it("requests nothing when NYCODE_OFFLINE is set", async () => {
		vi.stubEnv("NYCODE_OFFLINE", "1");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNycodeRelease("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("skips automatic api calls when version checks are disabled", async () => {
		process.env.NYCODE_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(checkForNewNycodeVersion("1.2.3")).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("allows direct api calls when automatic version checks are disabled", async () => {
		process.env.NYCODE_SKIP_VERSION_CHECK = "1";
		const fetchMock = vi.fn(async () => Response.json({ tag_name: "v1.2.4" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(getLatestNycodeVersion("1.2.3")).resolves.toBe("1.2.4");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
