import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

// `import ".../config.ts?as-bun-binary"` loads config.ts as a compiled Bun binary sees it: from a `$bunfs`
// URL. Only an explicit query opts in; every normal import keeps the real file URL.
const asBunBinary = {
	name: "as-bun-binary",
	transform(code: string, id: string) {
		if (!id.endsWith("?as-bun-binary")) return undefined;
		return { code: code.replaceAll("import.meta.url", JSON.stringify("file:///$bunfs/root/nycode")), map: null };
	},
};

export default mergeConfig(
	baseConfig,
	defineConfig({
		plugins: [asBunBinary],
		test: {
			globals: true,
			environment: "node",
			// resources/ holds embedded skill tests and the status-line tests run under node:test (see the "test" script), not vitest.
			exclude: [...configDefaults.exclude, "resources/**", "test/harness/statusline/**"],
			testTimeout: 30000,
			// Tests run offline by default; opt in with allowNetwork() from test/test-network-env.ts.
			env: { NYCODE_OFFLINE: "1" },
			unstubEnvs: true,
			reporters: process.env.GITHUB_ACTIONS ? ["dot", "github-actions"] : ["dot"],
			silent: "passed-only",
			server: {
				deps: {
					external: [/@silvia-odwyer\/photon-node/],
				},
			},
		},
		resolve: {
			alias: [
				{ find: /^@nycode\/ai$/, replacement: workspaceSourcePaths.aiIndex },
				{ find: /^@nycode\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			],
		},
	}),
);
