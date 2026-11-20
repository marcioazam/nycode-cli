import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const nycodeMessagesApi = (): ProviderStreams => lazyApi(() => import("./nycode-messages.ts"));
