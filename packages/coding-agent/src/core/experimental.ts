export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.NYCODE_EXPERIMENTAL === "1";
}
