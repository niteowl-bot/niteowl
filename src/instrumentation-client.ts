import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  // Captures existing console.error(...) calls in client components
  // as Sentry events, with no changes needed at those call sites.
  integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
