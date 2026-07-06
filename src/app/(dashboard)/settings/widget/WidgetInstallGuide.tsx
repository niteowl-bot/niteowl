"use client";

import { useState } from "react";

type PlatformId =
  | "wordpress"
  | "wix"
  | "squarespace"
  | "shopify"
  | "webflow"
  | "html"
  | "gtm";

interface Platform {
  id: PlatformId;
  label: string;
  steps: string[];
  note?: string;
}

const PLATFORMS: Platform[] = [
  {
    id: "wordpress",
    label: "WordPress",
    steps: [
      "Install a header/footer plugin such as “WPCode” or “Insert Headers and Footers” (avoids editing theme files directly, so updates won't wipe it out).",
      "In the plugin, open the “Footer” scripts section.",
      "Paste the embed code below.",
      "Save. Remy will appear on every page of your site.",
    ],
    note: "Using a page builder like Elementor or Divi instead? Add the same snippet via its “Custom HTML” or “Code” widget in your footer template.",
  },
  {
    id: "wix",
    label: "Wix",
    steps: [
      "From your Wix dashboard, go to Settings → Advanced → Custom Code.",
      "Click “+ Add Custom Code” and paste the embed code below.",
      "Set “Add Code to Pages” to All pages.",
      "Set the code placement to Body – end.",
      "Click Apply, then publish your site.",
    ],
    note: "Custom Code requires a Wix plan that supports it — check under Settings if you don't see this option.",
  },
  {
    id: "squarespace",
    label: "Squarespace",
    steps: [
      "Go to Settings → Advanced → Code Injection.",
      "Paste the embed code below into the Footer field.",
      "Save, then make sure your site is published (not just saved as a draft).",
    ],
  },
  {
    id: "shopify",
    label: "Shopify",
    steps: [
      "From your Shopify admin, go to Online Store → Themes.",
      "On your live (published) theme, click Edit code.",
      "Open Layout → theme.liquid.",
      "Paste the embed code below immediately before the closing </body> tag.",
      "Save.",
    ],
  },
  {
    id: "webflow",
    label: "Webflow",
    steps: [
      "Go to Project Settings → Custom Code.",
      "Paste the embed code below into the Footer Code section (applies site-wide).",
      "Save Changes, then Publish your site — custom code changes only take effect after a new publish.",
    ],
  },
  {
    id: "html",
    label: "HTML site",
    steps: [
      "Open the HTML file for each page you want Remy on.",
      "Paste the embed code below immediately before the closing </body> tag.",
      "Upload/deploy the updated file(s) to your live server.",
    ],
  },
  {
    id: "gtm",
    label: "Google Tag Manager",
    steps: [
      "In Google Tag Manager, create a New Tag.",
      "Choose tag type Custom HTML.",
      "Paste the embed code below into the HTML field, unchanged.",
      "Set the trigger to All Pages.",
      "Save, then Submit and Publish the container.",
    ],
    note: "If your site uses a cookie-consent tool, make sure this trigger doesn't require consent to fire, or Remy won't appear until a visitor accepts.",
  },
];

const TROUBLESHOOTING = [
  {
    q: "The widget isn't showing up at all",
    a: "Confirm you republished/saved after adding the code — Webflow, Wix, Squarespace, and GTM all require a separate publish step beyond just saving. Then view your site's page source (right-click → View Page Source) and search for “widget.js” to confirm the script tag actually made it onto the live page. If you use a caching plugin (e.g. WP Rocket, W3 Total Cache), purge the cache after adding the snippet.",
  },
  {
    q: "The widget shows on some pages but not others",
    a: "The snippet needs to be added site-wide (a global footer/layout template), not to a single page. In GTM, check the trigger is “All Pages”. In Wix, check “Add Code to Pages” is set to “All pages”.",
  },
  {
    q: "The widget shows, but customers get an error or it won't respond",
    a: "Re-copy the embed code below rather than retyping it — the widget key has to match exactly. Also check Settings → Billing to confirm your trial or subscription hasn't lapsed, since Remy pauses automatically when it does.",
  },
  {
    q: "An ad blocker or privacy extension seems to hide it",
    a: "Some aggressive ad or privacy blockers block third-party chat widgets. This only affects a small share of visitors and isn't something to fix on your end.",
  },
  {
    q: "My site has a strict Content Security Policy (CSP)",
    a: "Add niteowlhq.com to your script-src and connect-src CSP directives, or the browser will silently block the widget from loading.",
  },
];

export default function WidgetInstallGuide({
  snippet,
  website,
}: {
  snippet: string | null;
  website: string | null;
}) {
  const [activePlatform, setActivePlatform] = useState<PlatformId>("wordpress");
  const [copied, setCopied] = useState(false);
  const [checkUrl, setCheckUrl] = useState(website ?? "");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{
    installed: boolean;
    reason: string | null;
  } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const platform = PLATFORMS.find((p) => p.id === activePlatform)!;

  function handleCopy() {
    if (!snippet) return;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleVerify() {
    if (!checkUrl.trim()) return;
    setChecking(true);
    setCheckError(null);
    setResult(null);

    try {
      const res = await fetch("/api/widget/verify-install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: checkUrl.trim() }),
      });

      const json = await res.json();

      if (!res.ok) {
        setCheckError(json.error ?? "Something went wrong. Please try again.");
      } else {
        setResult({ installed: json.installed, reason: json.reason ?? null });
      }
    } catch {
      setCheckError("Something went wrong. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-white">Website Widget</h1>
      <p className="mb-8 text-sm text-white/40">
        Add Remy to your website so it can answer questions, capture leads,
        and book appointments for visitors in real time.
      </p>

      {/* Embed code — shared across every platform below */}
      <section className="mb-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
          Your embed code
        </p>
        <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
          {snippet ? (
            <>
              <pre className="overflow-x-auto rounded-lg bg-black/40 p-4 text-xs text-white/70">
                {snippet}
              </pre>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleCopy}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                >
                  {copied ? "Copied!" : "Copy snippet"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-white/40">
              No widget key found for your organisation yet.
            </p>
          )}
        </div>
      </section>

      {/* Platform-specific instructions */}
      <section className="mb-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
          Installation steps
        </p>
        <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-2">
          <div className="flex flex-wrap gap-1 border-b border-white/[0.07] p-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActivePlatform(p.id)}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  activePlatform === p.id
                    ? "bg-blue-600/15 text-blue-400"
                    : "text-white/50 hover:bg-white/5 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            <ol className="list-decimal space-y-2.5 pl-5 text-sm text-white/70">
              {platform.steps.map((step, i) => (
                <li key={i} className="leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
            {platform.note && (
              <p className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs leading-relaxed text-blue-300/90">
                {platform.note}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Verify installation */}
      <section className="mb-8">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
          Verify installation
        </p>
        <div className="rounded-2xl border border-white/[0.07] bg-[#13151c] p-6">
          <p className="mb-4 text-sm text-white/40">
            Enter your website address and we&apos;ll check whether Remy&apos;s
            widget is correctly installed.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={checkUrl}
              onChange={(e) => setCheckUrl(e.target.value)}
              placeholder="https://yourwebsite.com"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleVerify}
              disabled={checking || !checkUrl.trim()}
              className="shrink-0 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checking ? "Checking…" : "Check my website"}
            </button>
          </div>

          {checkError && (
            <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {checkError}
            </p>
          )}

          {result && (
            <div
              className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                result.installed
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/20 bg-amber-500/10 text-amber-300"
              }`}
            >
              {result.installed
                ? "Remy's widget is correctly installed on that page."
                : `Widget not confirmed. ${result.reason ?? "See troubleshooting below."}`}
            </div>
          )}
        </div>
      </section>

      {/* Troubleshooting */}
      <section>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
          Troubleshooting
        </p>
        <div className="space-y-2">
          {TROUBLESHOOTING.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl border border-white/[0.07] bg-[#13151c] p-4 open:pb-4"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-white marker:content-none">
                <span className="flex items-center justify-between">
                  {item.q}
                  <span className="text-white/30 transition group-open:rotate-180">
                    <ChevronIcon />
                  </span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-white/50">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3.5 5.5 7 9l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
