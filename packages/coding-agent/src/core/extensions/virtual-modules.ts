import * as bundledNycodeAgentCore from "@nycode/agent-core";
import * as bundledNycodeAiModels from "@nycode/ai/models";
import * as bundledNycodeAiOauth from "@nycode/ai/oauth";
import * as bundledNycodeAiProviders from "@nycode/ai/providers/all";
import * as bundledNycodeTui from "@nycode/tui";
import * as bundledTypebox from "typebox";
import * as bundledTypeboxCompile from "typebox/compile";
import * as bundledTypeboxValue from "typebox/value";
// This import is safe because loader.ts exports are not re-exported from index.ts.
// Extensions can therefore import from @nycode/coding-agent.
import * as bundledNycodeCodingAgent from "../../index.ts";
import * as bundledNycodeAiExtensionView from "./nycode-ai-extension-view.ts";

/** Modules available to extensions in source and compiled binary runtimes. */
export const VIRTUAL_MODULES: Record<string, unknown> = {
	typebox: bundledTypebox,
	"typebox/compile": bundledTypeboxCompile,
	"typebox/value": bundledTypeboxValue,
	"@sinclair/typebox": bundledTypebox,
	"@sinclair/typebox/compile": bundledTypeboxCompile,
	"@sinclair/typebox/value": bundledTypeboxValue,
	"@nycode/agent-core": bundledNycodeAgentCore,
	"@nycode/tui": bundledNycodeTui,
	// Extensions resolve the nycode-ai root to the compat entrypoint (a strict
	// superset of the core entrypoint) plus TypeBox's Type, Static and TSchema:
	// existing extensions using the old global API and nycode-ai's former TypeBox
	// re-exports keep working.
	"@nycode/ai": bundledNycodeAiExtensionView,
	"@nycode/ai/compat": bundledNycodeAiExtensionView,
	"@nycode/ai/models": bundledNycodeAiModels,
	"@nycode/ai/oauth": bundledNycodeAiOauth,
	"@nycode/ai/providers/all": bundledNycodeAiProviders,
	"@nycode/coding-agent": bundledNycodeCodingAgent,
};
