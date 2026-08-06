// Resolves this project's "@/*" path alias for the Node test runner.
//
// Node has no knowledge of tsconfig "paths", so importing a module that
// itself does `import ... from "@/lib/supabase/admin"` fails without this.
// Loaded via `--import ./tests/register.mjs` (see the "test" script).
// TypeScript itself needs no loader — Node 24 strips types natively.

import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

// Framework modules the lead engine imports but Node cannot resolve
// outside the Next build. See tests/stubs/next-server.mjs.
const STUBS = {
  "next/server": path.resolve(import.meta.dirname, "stubs", "next-server.mjs"),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { url: pathToFileURL(STUBS[specifier]).href, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
      for (const candidate of candidates) {
        // isFile(), not existsSync(): a bare "@/lib/integrations/providers"
        // matches the DIRECTORY, and handing Node a directory to load
        // fails with EISDIR instead of falling through to its index.ts.
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
