// p3's API, version 1, for every host kind (`@nycode/p3/v1`): Chord's plugin surface re-exported once (so a
// plugin that needs one more of Chord's exports never forces an API change), `defineFacet` typed with p3's
// principals, p3's host kinds, and the helpers for plugins (`forward`, `contribute`). Plugins import this
// module, never Chord: their builds leave it out and each process passes its own instance in.

import { defineFacet as chordFacet, type FacetHost, type FacetSelf, hostKind, str } from "@nycode/chord";
import type { P3Principal } from "../../principals.ts";

// Everything of Chord's root; the names this module defines itself (`defineFacet`, `Server`, `Session`) win over a
// same-named export of Chord's.
export * from "@nycode/chord";
export { BACKGROUND_CONTEXT, type Context } from "@nycode/chord/context";
export type { JsonValue } from "@nycode/chord/json";
// The contracts p3 promises to third-party plugins (Chord decision "The app kit, point 5"): the built-in plugins'
// own files, re-exported; a plugin built against `/v1` keeps v1's contracts.
export {
	Creator,
	SessionFacts,
	SessionRow,
	SessionStart,
	SessionState,
	Sessions,
	SessionsList,
	SessionWorker,
} from "../../../plugins/sessions/contract.ts";
export { P3Principal } from "../../principals.ts";
export { contribute } from "./contribute.ts";
export { forward } from "./forward.ts";

/** Defines a facet of p3: its factories get p3's principals. */
export function defineFacet(setup: (host: FacetHost<P3Principal>, self: FacetSelf) => void) {
	return chordFacet<P3Principal>(setup);
}

/** The server: one per Nycode. */
export const Server = hostKind("server");

/** A session: a worker process of its own, with its own store. */
export const Session = hostKind("session", { id: str() });
