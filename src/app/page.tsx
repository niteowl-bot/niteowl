import SalesChatWidget from "./SalesChatWidget";
import PricingPrice from "./PricingPrice";
import HeroDemo from "./HeroDemo";

// Objection-handling FAQ — every answer reflects real, shipped behaviour.
// Reused for both the visible section and the FAQPage structured data so
// they always match (a Google requirement for rich results).
const FAQS = [
  {
    q: "Do I need any technical skills to set up Remy?",
    a: "No. A short guided setup walks you through your business details, opening hours and a few knowledge entries, then you paste one snippet onto your website. Most owners are live in about 10 minutes.",
  },
  {
    q: "How does Remy know how to answer my customers?",
    a: "Remy answers from your Knowledge Base — your services, prices, hours, policies and FAQs. It never invents details, and anything it can't confidently answer is handed to you.",
  },
  {
    q: "What happens when Remy can't answer something?",
    a: "It politely takes the customer's details, saves the enquiry as a lead, and notifies you to follow up — so you never lose the enquiry, even out of hours.",
  },
  {
    q: "Can Remy actually book appointments?",
    a: "Yes. Remy checks your business hours and availability and books the appointment right in the chat, preventing double-bookings. Every booking appears in your dashboard and calendar.",
  },
  {
    q: "What does it cost, and can I cancel anytime?",
    a: "One simple plan with everything included, billed monthly. Start with a 14-day free trial — no card required — and cancel anytime.",
  },
  {
    q: "Will Remy replace my team?",
    a: "No. Remy handles routine questions and bookings around the clock and gracefully hands unusual requests to your team, so your people focus on the work only they can do.",
  },
];

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Remy",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Remy is an AI receptionist that answers customer questions instantly, captures every enquiry, and books appointments 24/7 — then hands unusual requests to your team.",
      offers: {
        "@type": "Offer",
        price: "79",
        priceCurrency: "GBP",
      },
      provider: {
        "@type": "Organization",
        name: "NiteOwl AI Ltd",
        url: "https://niteowlhq.com",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SalesChatWidget />

      {/* Accessibility: let keyboard/screen-reader users jump past the nav. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-white font-bold text-xl tracking-tight">
            niteowl<span className="text-indigo-400">.</span>
          </span>
          <div className="flex items-center gap-4">
            <a
              href="/login"
              className="text-slate-400 hover:text-white text-sm transition-colors"
            >
              Sign in
            </a>
            <a
              href="/signup"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Start free trial
            </a>
          </div>
        </div>
      </nav>

      <main id="main-content">
      {/* ── HERO ── */}
      <section className="bg-slate-950 pt-32 pb-24 px-6">
        <HeroDemo />
      </section>

      {/* ── PERFECT FOR ── */}
      <section className="bg-white py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-indigo-600 text-sm font-semibold uppercase tracking-widest mb-3">
              Built for local businesses
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              Perfect For
            </h2>
            <p className="text-slate-500 text-lg max-w-xl mx-auto">
              If you run a service business, Remy captures the enquiries you&apos;d
              otherwise miss — and pays for itself with the first job it books.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { icon: "🔧", label: "Plumbers" },
              { icon: "⚡", label: "Electricians" },
              { icon: "❄️", label: "HVAC" },
              { icon: "🦷", label: "Dentists" },
              { icon: "💪", label: "Physiotherapists" },
              { icon: "🐾", label: "Veterinary Clinics" },
              { icon: "🌿", label: "Landscapers" },
              { icon: "🧽", label: "Cleaning Services" },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-5 text-center transition-colors hover:border-indigo-200"
              >
                <div className="text-2xl mb-2" aria-hidden="true">
                  {item.icon}
                </div>
                <p className="text-slate-700 text-sm font-medium">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW REMY WORKS ── */}
      <section id="how-it-works" className="bg-slate-50 border-y border-slate-200 py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-indigo-600 text-sm font-semibold uppercase tracking-widest mb-3">
              The process
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
              How Remy Works
            </h2>
            <p className="text-slate-500 text-lg max-w-xl mx-auto">
              From first click to booked customer — automatically, day or night.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {[
              {
                step: "01",
                icon: "🌐",
                title: "Customer visits your website",
                description:
                  "A potential customer lands on your site with a question or job in mind.",
              },
              {
                step: "02",
                icon: "💬",
                title: "Remy answers instantly",
                description:
                  "Remy replies straight away using your business knowledge — no waiting, no missed enquiry.",
              },
              {
                step: "03",
                icon: "📥",
                title: "Enquiry is captured",
                description:
                  "Every conversation is saved as a lead with the customer's details and what they need.",
              },
              {
                step: "04",
                icon: "🔔",
                title: "You receive a notification",
                description:
                  "Anything that needs a human is flagged and sent to you so nothing slips through.",
              },
              {
                step: "05",
                icon: "✅",
                title: "Customer books or contacts you",
                description:
                  "Remy books the appointment or hands over the details, ready for you to close.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-2xl p-6 h-full"
              >
                <p className="text-slate-300 font-bold text-3xl mb-3 font-mono">
                  {item.step}
                </p>
                <div className="text-3xl mb-3" aria-hidden="true">
                  {item.icon}
                </div>
                <h3 className="text-slate-900 font-semibold text-base mb-2">
                  {item.title}
                </h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-14 text-center">
            <a
              href="/signup"
              className="inline-block bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
            >
              Start Your Free 14-Day Trial
            </a>
            <p className="text-slate-500 text-sm mt-4">
              No credit card required • Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF BAR ── */}
      <section className="bg-slate-900 border-y border-slate-800 py-5 px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12 text-center">
          {[
            { value: "< 5 sec", label: "Average reply time" },
            { value: "24/7", label: "Always available" },
            { value: "Auto", label: "Enquiry capture & alerts" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-white font-bold text-2xl">{stat.value}</p>
              <p className="text-slate-400 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="bg-white py-24 px-6">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-indigo-600 text-sm font-semibold uppercase tracking-widest mb-3">
            Pricing
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
            One plan. Everything included.
          </h2>
          <p className="text-slate-500 text-lg mb-12">
            Less than the cost of one lost customer per month.
          </p>

          <div className="bg-slate-950 rounded-2xl p-8 text-left shadow-xl ring-1 ring-indigo-500/30">
            <PricingPrice />
            <p className="text-slate-400 text-sm mb-8">
              Billed monthly · Cancel anytime
            </p>

            <ul className="space-y-3 mb-8">
              {[
                "Remy AI receptionist — always on",
                "Instant replies to website enquiries",
                "AI answers customer questions instantly",
                "Appointment booking & availability checks",
                "Automatic lead capture & CRM",
                "Customisable AI tone and responses",
                "500 SMS messages per month included",
                "Email support",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-slate-300 text-sm">
                  <svg
                    className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <a
              href="/signup"
              className="block w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 rounded-lg text-center transition-colors text-base"
            >
              Start Your Free 14-Day Trial
            </a>
            <p className="text-slate-500 text-xs text-center mt-3">
              No credit card required to start
            </p>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="bg-white py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-indigo-600 text-sm font-semibold uppercase tracking-widest mb-3">
              FAQ
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Everything you need to know
            </h2>
          </div>

          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {FAQS.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer items-center justify-between gap-4 list-none text-slate-900 font-semibold text-base marker:content-none">
                  {item.q}
                  <svg
                    className="w-5 h-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </summary>
                <p className="mt-3 text-slate-500 text-sm leading-relaxed">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA STRIP ── */}
      <section className="bg-indigo-600 py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            The next enquiry could be your best customer
          </h2>
          <p className="text-indigo-200 text-lg mb-8">
            Get Remy working for your business in under 10 minutes.
          </p>
          <a
            href="/signup"
            className="inline-block bg-white text-indigo-700 font-semibold px-8 py-3.5 rounded-lg hover:bg-indigo-50 transition-colors text-base"
          >
            Start Your Free 14-Day Trial
          </a>
        </div>
      </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-slate-950 border-t border-slate-800 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-white font-bold text-lg tracking-tight">
            niteowl<span className="text-indigo-400">.</span>
          </span>
          <div className="flex gap-6 text-slate-400 text-sm">
            <a href="/privacy" className="hover:text-white transition-colors">
              Privacy policy
            </a>
            <a href="/terms" className="hover:text-white transition-colors">
              Terms
            </a>
            <a
              href="mailto:contact@niteowlhq.com"
              className="hover:text-white transition-colors"
            >
              contact@niteowlhq.com
            </a>
          </div>
          <p className="text-slate-600 text-sm">
            © {new Date().getFullYear()} Niteowl AI Ltd
          </p>
        </div>
      </footer>

    </div>
  );
}
