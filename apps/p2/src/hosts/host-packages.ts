// The host packages of p2's facets: the modules a facet shares with its host as instances, by specifier. Apart from
// plugins.ts (the server's plugin component, which builds with esbuild) so the worker entry imports only these: a
// worker loads neither esbuild nor the server's API.
import * as nycodeAi from "@nycode/ai";
import * as anthropicMessages from "@nycode/ai/api/anthropic-messages.lazy";
import * as googleGenerativeAi from "@nycode/ai/api/google-generative-ai.lazy";
import * as openaiCompletions from "@nycode/ai/api/openai-completions.lazy";
import * as openaiResponses from "@nycode/ai/api/openai-responses.lazy";
import * as nycodeAiModels from "@nycode/ai/models";
import * as allProviders from "@nycode/ai/providers/all";
import * as fauxProvider from "@nycode/ai/providers/faux";
import * as radiusProvider from "@nycode/ai/providers/radius";
import * as radiusConfig from "@nycode/ai/providers/radius-config";
import * as nycodeCodemode from "@nycode/codemode";
import * as nycodeDurable from "@nycode/durable";
import * as durableCodemode from "@nycode/durable/codemode";
import * as durableEnv from "@nycode/durable/env";
import * as durableEnvNode from "@nycode/durable/env/node";
import * as durableImagesFit from "@nycode/durable/images/fit";
import * as durableToolSearch from "@nycode/durable/tool-search";
import * as durableTools from "@nycode/durable/tools";
import * as nycodeEnv from "@nycode/env";
import * as nycodeMcp from "@nycode/mcp";
import * as nycodeMcpOauth from "@nycode/mcp/oauth";
import * as nycodeSchema from "@nycode/schema";
import * as schemaFormats from "@nycode/schema/formats";
import * as nycodeTui from "@nycode/tui";
import * as ws from "ws";
import * as yaml from "yaml";
import * as api from "../api/v1/index.ts";
import * as apiNode from "../api/v1/node.ts";
import * as apiWorker from "../api/v1/worker.ts";

/** The packages a facet shares with its host as instances (never bundled into a plugin's script), by specifier. */
export const SHARED_PACKAGES = {
	"@nycode/ai": nycodeAi,
	"@nycode/ai/api/anthropic-messages.lazy": anthropicMessages,
	"@nycode/ai/api/google-generative-ai.lazy": googleGenerativeAi,
	"@nycode/ai/api/openai-completions.lazy": openaiCompletions,
	"@nycode/ai/api/openai-responses.lazy": openaiResponses,
	"@nycode/ai/models": nycodeAiModels,
	"@nycode/ai/providers/all": allProviders,
	"@nycode/ai/providers/faux": fauxProvider,
	"@nycode/ai/providers/radius": radiusProvider,
	"@nycode/ai/providers/radius-config": radiusConfig,
	"@nycode/codemode": nycodeCodemode,
	"@nycode/durable": nycodeDurable,
	"@nycode/durable/codemode": durableCodemode,
	"@nycode/durable/env": durableEnv,
	"@nycode/durable/env/node": durableEnvNode,
	"@nycode/durable/tool-search": durableToolSearch,
	"@nycode/durable/tools": durableTools,
	"@nycode/env": nycodeEnv,
	"@nycode/mcp": nycodeMcp,
	"@nycode/mcp/oauth": nycodeMcpOauth,
	"@nycode/schema": nycodeSchema,
	"@nycode/schema/formats": schemaFormats,
	ws,
	yaml,
};

/**
 * The host packages of worker facets (nycode-tui too: file completion ranks as nycode-tui's autocomplete does; Durable's image
 * fitting, with the worker's processor `WorkerParts.images`).
 */
export const WORKER_PACKAGES = {
	"@p2/app/v1": api,
	"@p2/app/v1/node": apiNode,
	"@p2/app/v1/worker": apiWorker,
	"@nycode/durable/images/fit": durableImagesFit,
	"@nycode/tui": nycodeTui,
	...SHARED_PACKAGES,
};
