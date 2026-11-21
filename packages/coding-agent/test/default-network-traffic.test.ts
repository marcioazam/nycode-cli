import { InMemoryCredentialStore, InMemoryModelsStore } from "@nycode/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { allowNetwork } from "./test-network-env.ts";

// With default configuration nycode talks only to the providers' own hosts: no catalog, gateway,
// installer or viewer server is named by default (decision D-30).
const PROVIDER_HOSTS = ["openrouter.ai"];

function requestedHosts(fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>): string[] {
	return fetchSpy.mock.calls.map(([input]) => new URL(input instanceof Request ? input.url : String(input)).host);
}

async function createRuntime(): Promise<ModelRuntime> {
	return ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsStore: new InMemoryModelsStore(),
		modelsPath: null,
		allowModelNetwork: true,
	});
}

beforeEach(() => {
	allowNetwork();
	vi.stubEnv("NYCODE_MODEL_CATALOG_URL", "");
	vi.stubEnv("NYCODE_RADIUS_GATEWAY", "");
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("default network traffic", () => {
	it("refreshes models without requesting any catalog or gateway server", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

		const runtime = await createRuntime();
		await runtime.refresh({ allowNetwork: true, force: true });

		expect(runtime.getModels().length).toBeGreaterThan(0);
		expect(requestedHosts(fetchSpy).filter((host) => !PROVIDER_HOSTS.includes(host))).toEqual([]);
	});

	it("requests a model catalog only from the URL in NYCODE_MODEL_CATALOG_URL", async () => {
		vi.stubEnv("NYCODE_MODEL_CATALOG_URL", "https://catalog.example.test");
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

		const runtime = await createRuntime();
		await runtime.setRuntimeApiKey("anthropic", "test-key");
		await runtime.refresh({ allowNetwork: true, force: true, providers: ["anthropic"] });

		const urls = fetchSpy.mock.calls.map(([input]) => String(input));
		expect(urls.some((url) => url.startsWith("https://catalog.example.test/api/models/providers/anthropic"))).toBe(
			true,
		);
		expect(
			requestedHosts(fetchSpy).filter((host) => ![...PROVIDER_HOSTS, "catalog.example.test"].includes(host)),
		).toEqual([]);
	});
});
