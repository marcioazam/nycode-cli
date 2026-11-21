// Ports import/ny-pi/extensions/ui/test/a11y.test.ts. The plainHeader cases moved to the core (K10):
// test/harness/core/appearance/header-no-color.test.ts.
import assert from "node:assert/strict";
import { test } from "vitest";
import type { ExtensionAPI } from "../../../../src/core/extensions/types.ts";
import type { Settings } from "../../../../src/core/settings-schema.ts";
import a11y, { noColor, reducedMotion } from "../../../../src/extensions/ui/a11y.ts";

const api = (settings: Settings = {}) => ({ getSettings: () => settings }) as unknown as ExtensionAPI;

test("noColor: só valor não vazio liga", () => {
	assert.equal(noColor({}), false);
	assert.equal(noColor({ NO_COLOR: "" }), false);
	assert.equal(noColor({ NO_COLOR: "1" }), true);
});

test("reducedMotion: só NYCODE_REDUCED_MOTION verdadeiro liga", () => {
	assert.equal(reducedMotion(api(), {}), false);
	assert.equal(reducedMotion(api(), { NYCODE_REDUCED_MOTION: "0" }), false);
	assert.equal(reducedMotion(api(), { NYCODE_REDUCED_MOTION: "1" }), true);
});

test("reducedMotion: terminal.reducedMotion do settings.json liga; a variável vence o settings", () => {
	assert.equal(reducedMotion(api({ terminal: { reducedMotion: true } }), {}), true);
	assert.equal(reducedMotion(api({ terminal: { reducedMotion: true } }), { NYCODE_REDUCED_MOTION: "0" }), false);
});

test("reducedMotion: NO_PROGRESS não vazio também liga", () => {
	assert.equal(reducedMotion(api(), { NO_PROGRESS: "" }), false);
	assert.equal(reducedMotion(api(), { NO_PROGRESS: "1" }), true);
});

function run(
	env: Record<string, string>,
	hasUI: boolean,
	themeResult = { success: true } as { success: boolean; error?: string },
) {
	const saved = { NO_COLOR: process.env.NO_COLOR, NYCODE_REDUCED_MOTION: process.env.NYCODE_REDUCED_MOTION };
	delete process.env.NO_COLOR;
	delete process.env.NYCODE_REDUCED_MOTION;
	Object.assign(process.env, env);
	const calls: unknown[][] = [];
	let handler: ((event: unknown, ctx: unknown) => void) | undefined;
	a11y({
		on: (_name: string, h: (event: unknown, ctx: unknown) => void) => {
			handler = h;
		},
		getSettings: () => ({}),
	} as unknown as ExtensionAPI);
	handler?.(
		{},
		{
			hasUI,
			ui: {
				getTheme: (n: string) => (themeResult.success ? { themeObject: n } : undefined),
				setTheme: (t: unknown) => {
					calls.push(["theme", t]);
					return themeResult;
				},
				setWorkingIndicator: (o: unknown) => calls.push(["indicator", o]),
				notify: (m: string, l: string) => calls.push(["notify", l, m]),
			},
		},
	);
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	return calls;
}

// O nycode grava em settings.json o tema trocado por nome (setTheme(name) chama settingsManager.setTheme); por
// objeto (setThemeInstance) vale só para a sessão. Antes do conserto, uma única sessão com NO_COLOR deixou
// "theme": "mono" salvo e todas as sessões seguintes ficaram sem cor.
test("NO_COLOR aplica o tema mono só nesta sessão (objeto, não nome); falha vira aviso", () => {
	assert.deepEqual(run({ NO_COLOR: "1" }, true), [["theme", { themeObject: "mono" }]]);
	const c = run({ NO_COLOR: "1" }, true, { success: false, error: "x" });
	assert.deepEqual(c[0], ["notify", "warning", "NO_COLOR: tema mono indisponível (tema não encontrado)"]);
	assert.ok(!c.some((x) => x[0] === "theme"), "sem tema, nada é trocado nem gravado");
});

test("NYCODE_REDUCED_MOTION troca o indicador por um quadro estático", () => {
	assert.deepEqual(run({ NYCODE_REDUCED_MOTION: "1" }, true), [["indicator", { frames: ["●"] }]]);
});

test("sem UI ou sem env não faz nada", () => {
	assert.deepEqual(run({ NO_COLOR: "1" }, false), []);
	assert.deepEqual(run({}, true), []);
});
