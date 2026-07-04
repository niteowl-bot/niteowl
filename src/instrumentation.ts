import * as Sentry from "@sentry/nextjs";

// Captures every existing console.error(...) call across the codebase
// as a Sentry event, with no changes needed at any of those call
// sites — restricted to "error" so the many informational
// console.log calls don't burn through the event quota.
const integrations = [Sentry.captureConsoleIntegration({ levels: ["error"] })];

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      integrations,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0,
      integrations,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
