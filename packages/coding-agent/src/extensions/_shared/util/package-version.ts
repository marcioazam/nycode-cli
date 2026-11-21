/**
 * nycode's own version. The package.json lookup of pi-code (two directories above the extension) has no
 * meaning inside the core, where `VERSION` in src/config.ts already reads the package manifest.
 */

import { VERSION } from "../../../config.ts";

export const PACKAGE_VERSION: string = VERSION;
