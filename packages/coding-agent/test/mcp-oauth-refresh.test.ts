import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type McpOAuthServerStore,
	type McpOAuthSettings,
	McpSignInCancelledError,
	type OAuthChallenge,
	OAuthIssuerMismatchError,
} from "@nycode/mcp/oauth";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryAuthStorageBackend } from "../src/core/auth-storage.ts";
import {
	createMcpAuthProvider,
	McpOAuthCredentialStore,
	type McpSignInPrompt,
	signInMcpServer,
} from "../src/extensions/mcp/oauth.ts";
import { startOAuthMcpServer } from "./suite/mcp-oauth-server.ts";

describe("MCP OAuth refresh", () => {
	const cleanups: (() => Promise<void> | void)[] = [];

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	async function signedIn() {
		const server = await startOAuthMcpServer();
		cleanups.push(server.close);
		const lockDir = mkdtempSync(join(tmpdir(), "nycode-mcp-refresh-"));
		cleanups.push(() => rmSync(lockDir, { recursive: true, force: true }));
		// Stores sharing the credential file and lock directory stand in for separate nycode processes.
		const backend = new InMemoryAuthStorageBackend();
		const process = () => {
			const store = new McpOAuthCredentialStore(backend, lockDir).forServer("test", server.url);
			const provider = createMcpAuthProvider({
				serverUrl: server.url,
				store,
				settings: () => ({}),
				onChallenge: () => {},
			});
			return { store, provider };
		};
		await signInMcpServer({
			serverUrl: server.url,
			store: process().store,
			settings: {},
			prompt: {
				showAuthorizationUrl: (url) => void fetch(url),
				promptForRedirectUrl: (signal) =>
					new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
			},
		});
		return { server, lockDir, process };
	}

	it("refreshes once when several processes find the same token rejected", async () => {
		const { server, lockDir, process } = await signedIn();
		server.expireAccessTokens();
		const processes = [process(), process(), process()];

		// The server rotates refresh tokens: a second refresh with refresh-1 would fail with invalid_grant.
		await Promise.all(
			processes.map(({ provider }) =>
				provider.onUnauthorized?.({
					response: new Response(null, { status: 401 }),
					serverUrl: new URL(server.url),
					fetch: globalThis.fetch,
					token: "access-1",
				}),
			),
		);

		expect(server.log.filter((entry) => entry === "token refresh")).toHaveLength(1);
		for (const { provider } of processes) expect(await provider.token()).toBe("access-2");
		// The lock is released.
		expect(readdirSync(lockDir)).toEqual([]);
	});

	it("cancels a sign-in that waits for another process's refresh", async () => {
		const { server, lockDir, process } = await signedIn();
		let release = () => {};
		const held = process().store.withRefreshLock(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		// The sign-in's store, recording its wait for the lock.
		const store = process().store;
		let waiting: Promise<unknown> | undefined;
		const recording: McpOAuthServerStore = {
			...store,
			withRefreshLock: (fn) => {
				const run = store.withRefreshLock(fn);
				waiting = run;
				return run;
			},
		};
		const controller = new AbortController();
		const signIn = signInMcpServer({
			serverUrl: server.url,
			store: recording,
			settings: {},
			prompt: { showAuthorizationUrl: () => {}, promptForRedirectUrl: async () => undefined },
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 200);
		await expect(signIn).rejects.toBeInstanceOf(McpSignInCancelledError);

		release();
		await held;
		// The cancelled sign-in takes the lock once it is free and releases it without refreshing.
		await waiting;
		expect(server.log.filter((entry) => entry === "token refresh")).toHaveLength(0);
		expect(readdirSync(lockDir)).toEqual([]);
	});

	it("waits for a running refresh to save the new tokens", async () => {
		const { server, process } = await signedIn();
		server.expireAccessTokens();
		const { store, provider } = process();

		const refresh = provider.onUnauthorized?.({
			response: new Response(null, { status: 401 }),
			serverUrl: new URL(server.url),
			fetch: globalThis.fetch,
			token: "access-1",
		});
		await provider.settled();
		expect((await store.load())?.tokens?.access_token).toBe("access-2");
		await refresh;
	});
});

describe("MCP OAuth sign-in", () => {
	async function signIn(options: { iss?: string }, settings: (serverUrl: string) => McpOAuthSettings = () => ({})) {
		const server = await startOAuthMcpServer(options);
		try {
			await signInMcpServer({
				serverUrl: server.url,
				store: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer("test", server.url),
				settings: settings(server.url),
				prompt: {
					showAuthorizationUrl: (url) => void fetch(url),
					promptForRedirectUrl: (signal) =>
						new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
				},
			});
		} finally {
			await server.close();
		}
	}

	it("rejects an authorization response from another issuer", async () => {
		await expect(signIn({ iss: "https://attacker.example" })).rejects.toBeInstanceOf(OAuthIssuerMismatchError);
	});

	it("keeps the granted scope when the server asks for more", async () => {
		const server = await startOAuthMcpServer();
		try {
			const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer("test", server.url);
			const opened: URL[] = [];
			const signInWith = (challenge: OAuthChallenge) =>
				signInMcpServer({
					serverUrl: server.url,
					store,
					settings: {},
					challenge,
					prompt: {
						showAuthorizationUrl: (url) => {
							opened.push(url);
							void fetch(url);
						},
						promptForRedirectUrl: (signal) =>
							new Promise((resolve) =>
								signal.addEventListener("abort", () => resolve(undefined), { once: true }),
							),
					},
				});

			await signInWith({ scope: "issues:read" });
			// The token response names no scope, so the grant has the requested one.
			expect((await store.load())?.tokens?.scope).toBe("issues:read");
			// The step-up challenge lists only the missing scope. Requesting just that would lose
			// issues:read, so the next request would ask for sign-in again.
			await signInWith({ error: "insufficient_scope", scope: "issues:write" });
			expect(opened.map((url) => url.searchParams.get("scope"))).toEqual([
				"issues:read",
				"issues:read issues:write",
			]);
			expect((await store.load())?.tokens?.scope).toBe("issues:read issues:write");
		} finally {
			await server.close();
		}
	});

	// #10172
	it("uses the configured authorization server metadata URL", async () => {
		const settings = (serverUrl: string) => ({ authServerMetadataUrl: new URL("/missing", serverUrl) });
		await expect(signIn({}, settings)).rejects.toThrow("HTTP 404 loading authorization server metadata");
	});
});

// nycode publishes no Client ID Metadata Documents (no default document): it always registers.
describe("MCP OAuth client registration", () => {
	const cleanups: (() => Promise<void>)[] = [];
	const cimd: McpOAuthSettings = { clientRegistration: "cimd" };
	const dcr: McpOAuthSettings = { clientRegistration: "dcr" };

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	async function startServer(options: { issParameter?: boolean; cimd?: boolean; redirectPath?: string }) {
		const server = await startOAuthMcpServer(options);
		cleanups.push(server.close);
		const store = new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()).forServer("test", server.url);
		const browser: McpSignInPrompt = {
			showAuthorizationUrl: (url) => void fetch(url),
			promptForRedirectUrl: (signal) =>
				new Promise((resolve) => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
		};
		const signIn = (settings: McpOAuthSettings, prompt = browser) =>
			signInMcpServer({ serverUrl: server.url, store, settings, prompt });
		return { server, store, signIn };
	}

	it("registers dynamically with dcr, even when the server supports documents", async () => {
		const { server, signIn } = await startServer({ cimd: true, issParameter: true });
		await signIn(dcr);
		expect(server.registrations).toHaveLength(1);
		expect(server.authorizations[0].get("client_id")).toBe("client-1");
	});

	// #11426
	it("registers dynamically by default, even when the server supports documents", async () => {
		const { server, store, signIn } = await startServer({ cimd: true, issParameter: true });
		await signIn({});
		const [authorization] = server.authorizations;
		expect(authorization.get("client_id")).toBe("client-1");
		expect(server.registrations).toHaveLength(1);
		expect(server.tokenRequests[0].get("client_id")).toBe("client-1");
		expect((await store.load())?.clientInformation?.client_id).toBe("client-1");
		// The registered client is stored, so signing in again refreshes the tokens.
		await signIn({});
		expect(server.authorizations).toHaveLength(1);
		expect(server.tokenRequests[1].get("grant_type")).toBe("refresh_token");
	});

	// #11426
	it("registers dynamically by default when the server does not support documents", async () => {
		const { server, signIn } = await startServer({ issParameter: true });
		await signIn({});
		expect(server.registrations).toHaveLength(1);
		expect(server.authorizations[0].get("client_id")).toBe("client-1");
	});

	// #11426
	it("registers dynamically by default with a client name", async () => {
		const { server, signIn } = await startServer({ cimd: true, issParameter: true });
		await signIn({ clientName: "Claude Code" });
		expect(server.registrations).toMatchObject([{ client_name: "Claude Code" }]);
	});

	// #11426
	it("keeps a registered client by default", async () => {
		const { server, store, signIn } = await startServer({ cimd: true, issParameter: true });
		await signIn(dcr);
		await signIn({});
		// The registered client's tokens are refreshed instead of signing in with the document.
		expect(server.authorizations).toHaveLength(1);
		expect(server.tokenRequests[1].get("grant_type")).toBe("refresh_token");
		expect(server.tokenRequests[1].get("client_id")).toBe("client-1");
		expect((await store.load())?.clientInformation?.client_id).toBe("client-1");
	});

	it("fails instead of registering with cimd, because nycode has no documents", async () => {
		const { server, signIn } = await startServer({ cimd: true, issParameter: true });
		await expect(signIn(cimd)).rejects.toThrow("needs Client ID Metadata Documents");
		expect(server.registrations).toEqual([]);
	});
});
