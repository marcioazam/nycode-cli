// The API's modules a session worker evaluates its plugins' worker facets with, this process's instances by
// specifier: never the server's module, which holds the HTTP stack.

import * as v1 from "@nycode/p3/v1";
import * as v1worker from "@nycode/p3/v1/worker";

/** A worker's API modules by specifier. */
export const WORKER_MODULES = { "@nycode/p3/v1": v1, "@nycode/p3/v1/worker": v1worker };
