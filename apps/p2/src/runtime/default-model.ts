// The default model from the environment (Nycode Mobile's NYCODE_MOBILE_PROVIDER/NYCODE_MOBILE_MODEL, as P2_PROVIDER/P2_MODEL):
// after settings.json's defaultModel, before the first signed-in model.

export type EnvModel = { readonly provider: string; readonly modelId: string };

/** Both or neither: a provider without a model (or the reverse) is a configuration error. */
export function envDefaultModel(env: NodeJS.ProcessEnv = process.env): EnvModel | undefined {
	const provider = env.P2_PROVIDER ?? env.NYCODE_MOBILE_PROVIDER;
	const modelId = env.P2_MODEL ?? env.NYCODE_MOBILE_MODEL;
	if (Boolean(provider) !== Boolean(modelId)) throw new Error("Set both P2_PROVIDER and P2_MODEL");
	return provider && modelId ? { provider, modelId } : undefined;
}
