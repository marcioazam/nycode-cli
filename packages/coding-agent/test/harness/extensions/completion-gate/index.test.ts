// Ported from import/ny-pi/claude-home/bin/tests/gates/completion-gate.test.ts (14 cases; the kill-switch half
// of the plan-mode case now goes through the handler and `harness.completionGate` / NYCODE_COMPLETION_GATE).
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import completionGateExtension, {
	decideCompletionGate,
	isCheckCommand,
} from "../../../../src/extensions/completion-gate/index.ts";

describe("completion-gate", () => {
	type Entry = Record<string, unknown>;
	let n = 0;
	const id = () => `e${++n}`;
	const user = (text = "faça"): Entry => ({ type: "message", id: id(), message: { role: "user", content: text } });
	const say = (text: string): Entry => ({
		type: "message",
		id: id(),
		message: { role: "assistant", content: [{ type: "text", text }] },
	});
	const call = (name: string, args: Record<string, unknown>, callId = `c${n + 1}`): Entry => ({
		type: "message",
		id: id(),
		message: { role: "assistant", content: [{ type: "toolCall", id: callId, name, arguments: args }] },
	});
	const result = (callId: string, toolName: string, isError = false): Entry => ({
		type: "message",
		id: id(),
		message: { role: "toolResult", toolCallId: callId, toolName, isError, content: [{ type: "text", text: "ok" }] },
	});
	const edit = (path: string): Entry => call("edit", { path, edits: [] });
	const bash = (command: string, callId: string, isError = false): Entry[] => [
		call("bash", { command }, callId),
		result(callId, "bash", isError),
	];
	it("sem edição: nada a fazer", () => {
		assert.equal(decideCompletionGate([user(), say("oi")]).action, "none");
	});

	it("código editado sem checagem: bloqueia citando o arquivo", () => {
		const d = decideCompletionGate([user(), edit("src/a.py"), say("pronto")]);
		assert.equal(d.action, "block");
		assert.deepEqual(d.files, ["src/a.py"]);
		assert.match(d.message ?? "", /src\/a\.py/);
		assert.match(d.message ?? "", /once per turn/);
	});

	it("checagem aprovada depois da edição: libera", () => {
		const d = decideCompletionGate([user(), edit("a.go"), ...bash("cd x && go test ./...", "b1"), say("ok")]);
		assert.equal(d.action, "none");
	});

	it("checagem que falhou não conta", () => {
		const d = decideCompletionGate([user(), edit("a.ts"), ...bash("npm run typecheck", "b1", true), say("ok")]);
		assert.equal(d.action, "block");
	});

	it("checagem antes da última edição não conta", () => {
		const d = decideCompletionGate([user(), edit("a.rs"), ...bash("cargo test", "b1"), edit("b.rs"), say("ok")]);
		assert.equal(d.action, "block");
		assert.deepEqual(d.files, ["a.rs", "b.rs"]);
	});

	it("bash que não é checagem não conta", () => {
		const d = decideCompletionGate([user(), edit("a.py"), ...bash("ls -la && cat a.py", "b1"), say("ok")]);
		assert.equal(d.action, "block");
	});

	it("só docs e config: nada a fazer", () => {
		const d = decideCompletionGate([
			user(),
			edit("README.md"),
			call("write", { path: "c.json", content: "{}" }),
			say("ok"),
		]);
		assert.equal(d.action, "none");
	});

	it("gate-runner depois da edição libera (single e tasks)", () => {
		const single = decideCompletionGate([
			user(),
			edit("a.py"),
			call("subagent", { agent: "gate-runner", task: "x" }, "s1"),
			result("s1", "subagent"),
			say("ok"),
		]);
		assert.equal(single.action, "none");
		const many = decideCompletionGate([
			user(),
			edit("a.py"),
			call("subagent", { tasks: [{ agent: "gate-runner", task: "x" }] }, "s2"),
			result("s2", "subagent"),
			say("ok"),
		]);
		assert.equal(many.action, "none");
	});

	it("bloqueia uma vez por turno e rearma no turno seguinte", () => {
		const blocked: Entry = { type: "custom", id: id(), customType: "completion-gate", data: {} };
		const turn = [user(), edit("a.py"), say("ok"), blocked, say("adiado: verifico antes do commit")];
		assert.equal(decideCompletionGate(turn).action, "none");
		assert.equal(decideCompletionGate([...turn, user("mais"), edit("b.py"), say("ok")]).action, "block");
	});

	it("edição de turno anterior não bloqueia o turno atual", () => {
		assert.equal(
			decideCompletionGate([user(), edit("a.py"), say("ok"), user("pergunta"), say("resposta")]).action,
			"none",
		);
	});

	it("isCheckCommand: checagens reais em qualquer segmento, atrás de wrappers", () => {
		for (const c of [
			"pytest -q",
			"cd x && go test ./...",
			"python3 -m unittest test_a.py",
			"uv run --with hcl2 pytest",
			"npm run typecheck",
			"node --experimental-strip-types --test a.test.ts",
			"FOO=1 timeout 60 cargo test",
			"./gradlew test",
			"python3 scripts/checks/check-instructions.py",
			"npx tsc --noEmit",
			"make check 2>&1",
			"ls; ruff check .",
			"bash -n x.sh",
		])
			assert.equal(isCheckCommand(c), true, c);
	});

	it("isCheckCommand: menção de ferramenta não é checagem", () => {
		for (const c of [
			"rg pytest .",
			"cat eslint.config.js",
			"grep -n tsc package.json",
			"python3 x.py",
			"echo go test",
			"ls tests/",
		])
			assert.equal(isCheckCommand(c), false, c);
	});

	it("plan mode desliga", () => {
		const planOn: Entry = { type: "custom", id: id(), customType: "plan-mode", data: { enabled: true } };
		assert.equal(decideCompletionGate([planOn, user(), edit("a.py"), say("ok")]).action, "none");
	});

	it("isCheckCommand: entrada adversarial termina rápido (sem ReDoS)", () => {
		for (const prefix of ["systemd-run", "uv run"]) {
			const start = performance.now();
			assert.equal(isCheckCommand(`${prefix}${" a".repeat(5000)}`), false);
			assert.ok(performance.now() - start < 50);
		}
		assert.equal(isCheckCommand("systemd-run --user -- pytest"), true);
		// CodeQL js/redos (PR #66): a alternativa `node` era exponencial em 'node ' + '-- -'×n (22 repetições ~20 ms).
		const start = performance.now();
		assert.equal(isCheckCommand(`node ${"-- -".repeat(40)} x`), false);
		assert.ok(performance.now() - start < 50);
		for (const c of [
			"node --test",
			"node --experimental-strip-types --test a.ts",
			"node --max-old-space-size=4096 --test",
		]) {
			assert.equal(isCheckCommand(c), true, c);
		}
		assert.equal(isCheckCommand("node a.js --test"), false);
	});

	const ctxFor = (entries: Entry[]) => ({ sessionManager: { getBranch: () => entries } });

	function load(settings: unknown): (event: unknown, ctx: unknown) => Promise<any> {
		let handler: ((event: unknown, ctx: unknown) => Promise<any>) | undefined;
		completionGateExtension({
			getSettings: () => settings,
			on: (_event: string, fn: typeof handler) => {
				handler = fn;
			},
		} as unknown as ExtensionAPI);
		if (!handler) throw new Error("handler not registered");
		return handler;
	}

	describe("completion-gate handler", () => {
		afterEach(() => {
			delete process.env.NYCODE_COMPLETION_GATE;
			delete process.env.NYCODE_SUBAGENT;
		});
		const turn = () => [user(), edit("a.py"), say("ok")];

		it("blocks and continues with the gate entries when code was edited without a check", async () => {
			const out = await load({})({ entries: [] }, ctxFor(turn()));
			assert.equal(out.continue, true);
			assert.equal(out.entries[0].customType, "completion-gate");
			assert.equal(out.entries[1].type, "custom_message");
		});

		it("harness.completionGate=false and NYCODE_COMPLETION_GATE=0 turn it off; the variable wins over the setting", async () => {
			assert.equal(await load({ harness: { completionGate: false } })({ entries: [] }, ctxFor(turn())), undefined);
			process.env.NYCODE_COMPLETION_GATE = "0";
			assert.equal(await load({})({ entries: [] }, ctxFor(turn())), undefined);
			process.env.NYCODE_COMPLETION_GATE = "1";
			assert.equal(
				(await load({ harness: { completionGate: false } })({ entries: [] }, ctxFor(turn()))).continue,
				true,
			);
		});

		it("registers nothing inside a subagent worker", () => {
			process.env.NYCODE_SUBAGENT = "1";
			let registered = false;
			completionGateExtension({
				getSettings: () => ({}),
				on: () => {
					registered = true;
				},
			} as unknown as ExtensionAPI);
			assert.equal(registered, false);
		});

		it("fails open when the branch cannot be read", async () => {
			assert.equal(await load({})({ entries: [] }, {}), undefined);
		});
	});
});
