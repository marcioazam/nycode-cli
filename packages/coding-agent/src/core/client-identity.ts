import { type ClientIdentity, NYCODE_ATTRIBUTION } from "@nycode/ai";
import { VERSION } from "../config.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";

/**
 * How nycode's requests identify it to providers: a detailed `User-Agent` with nycode's version, and attribution to nycode as a
 * CLI agent while install telemetry is enabled.
 */
export function getClientIdentity(settingsManager: SettingsManager): ClientIdentity {
	return {
		userAgent: "detailed",
		version: VERSION,
		attribution: isInstallTelemetryEnabled(settingsManager) ? NYCODE_ATTRIBUTION : null,
	};
}
