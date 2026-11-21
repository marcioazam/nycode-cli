import { normalizeRadiusGatewayUrl } from "@nycode/ai/providers/radius-config";

export const RADIUS_PROVIDER_ID = "radius";
export const ENV_RADIUS_GATEWAY = "NYCODE_RADIUS_GATEWAY";

/** Radius gateway origin from `NYCODE_RADIUS_GATEWAY`, or undefined: there is no default gateway. */
export function getRadiusGatewayUrl(): string | undefined {
	const value = process.env[ENV_RADIUS_GATEWAY]?.trim();
	return value ? normalizeRadiusGatewayUrl(value) : undefined;
}

/** MCP endpoint of the configured gateway, or undefined without one. */
export function getRadiusMcpUrl(): string | undefined {
	const gateway = getRadiusGatewayUrl();
	return gateway ? `${gateway}/mcp` : undefined;
}
