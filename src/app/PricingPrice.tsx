"use client";

import { useEffect, useState } from "react";

// ── Marketing-page pricing display only ──────────────────────────
// This does not touch Stripe/checkout — the checkout flow always
// charges the single GBP price configured via STRIPE_PRICE_ID. These
// are fixed display prices shown to visitors before they sign up.

const PRICES = {
  GBP: { symbol: "£", amount: 79 },
  EUR: { symbol: "€", amount: 95 },
  USD: { symbol: "$", amount: 109 },
} as const;

type CurrencyCode = keyof typeof PRICES;

const CURRENCY_CODES = Object.keys(PRICES) as CurrencyCode[];
const STORAGE_KEY = "niteowl_pricing_currency";

const EURO_REGIONS = new Set([
  "DE", "FR", "ES", "IT", "NL", "BE", "AT", "IE", "PT", "FI",
  "GR", "LU", "SK", "SI", "EE", "LV", "LT", "CY", "MT", "HR",
]);

function detectCurrency(): CurrencyCode {
  if (typeof navigator === "undefined") return "GBP";

  const region = (navigator.language || "en-GB").split("-")[1]?.toUpperCase();

  if (region === "US") return "USD";
  if (region === "GB") return "GBP";
  if (region && EURO_REGIONS.has(region)) return "EUR";

  return "GBP";
}

export default function PricingPrice() {
  const [currency, setCurrency] = useState<CurrencyCode>("GBP");

  useEffect(() => {
    // Currency depends on browser-only APIs (localStorage/navigator) that
    // aren't available during SSR, so it must be resolved after mount to
    // avoid a hydration mismatch — the GBP default above is the SSR output.
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrency(
      stored && stored in PRICES ? (stored as CurrencyCode) : detectCurrency()
    );
  }, []);

  function handleSelect(code: CurrencyCode) {
    setCurrency(code);
    window.localStorage.setItem(STORAGE_KEY, code);
  }

  const { symbol, amount } = PRICES[currency];

  return (
    <div className="flex items-start justify-between gap-3 mb-1">
      <div className="flex items-end gap-2">
        <span className="text-white font-bold text-5xl">
          {symbol}
          {amount}
        </span>
        <span className="text-slate-400 mb-2">/month</span>
      </div>
      <div
        className="flex gap-1 shrink-0"
        role="group"
        aria-label="Select currency"
      >
        {CURRENCY_CODES.map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => handleSelect(code)}
            aria-pressed={currency === code}
            className={`text-xs font-medium w-7 h-7 rounded-md transition-colors ${
              currency === code
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            {PRICES[code].symbol}
          </button>
        ))}
      </div>
    </div>
  );
}
