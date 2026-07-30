// Resolves this project's "@/*" path alias for the Node test runner.
//
// Node has no knowledge of tsconfig "paths", so importing a module that
// itself does `import ... from "@/lib/supabase/admin"` fails without this.
// Loaded via `--import ./tests/register.mjs` (see the "test" script).
// TypeScript itself needs no loader — Node 24 strips types natively.

import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
