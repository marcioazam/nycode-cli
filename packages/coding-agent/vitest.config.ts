import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig, { workspaceSourcePaths } from "../../vitest.base.ts";

export default mergeConfig(
	baseConfig,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
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
				{ find: /^@mariozechner\/nycode-ai$/, replacement: workspaceSourcePaths.aiIndex },
				{ find: /^@mariozechner\/nycode-ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
				{ find: /^@mariozechner\/nycode-agent-core$/, replacement: workspaceSourcePaths.agentIndex },
				{ find: /^@mariozechner\/nycode-tui$/, replacement: workspaceSourcePaths.tuiIndex },
			],
		},
	}),
);
