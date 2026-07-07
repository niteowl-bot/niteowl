import SalesChatWidget from "./SalesChatWidget";
import PricingPrice from "./PricingPrice";

export default function Home() {
  return (
    <div className="min-h-screen bg-white font-sans">
      <SalesChatWidget />

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

      {/* ── HERO ── */}
      <section className="bg-slate-950 pt-32 pb-24 px-6">
        <div className="max-w-4xl mx-auto text-center">

          <div className="inline-flex items-center gap-2 bg-indigo-950 border border-indigo-800 text-indigo-300 text-xs font-medium px-3 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
            AI receptionist — always on, never misses a call
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight mb-6">
            Never lose a customer to a{" "}
            <span className="text-indigo-400">missed call</span> again
          </h1>

          <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Remy, your AI receptionist, texts back every missed call in seconds.
            Day or night.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/signup"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
            >
              Start free trial
            </a>
            <a
              href="#how-it-works"
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold px-8 py-3.5 rounded-lg transition-colors text-base"
            >
              See how it works
            </a>
          </div>

          <p className="text-slate-500 text-sm mt-5">
            14-day free trial · No credit card required · Cancel anytime
          </p>
        </div>

        {/* Mock phone conversation */}
        <div className="max-w-sm mx-auto mt-16">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 shadow-2xl">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-700">
              <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                R
              </div>
              <div>
                <p className="text-white text-sm font-medium">Remy · AI Receptionist</p>
                <p className="text-slate-500 text-xs">niteowl.ai</p>
              </div>
              <span className="ml-auto w-2 h-2 bg-green-400 rounded-full" />
            </div>
            <div className="space-y-3 text-sm">
              <div className="bg-slate-800 text-slate-300 rounded-xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                📞 Missed call from +44 7700 900123
              </div>
              <div className="bg-indigo-600 text-white rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%] ml-auto text-right">
                Hi! Sorry we missed your call to City Plumbing. How can we help? Reply and we&apos;ll get right back to you 👋
              </div>
              <div className="bg-slate-800 text-slate-300 rounded-xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                Hi, I need an emergency boiler repair today
              </div>
              <div className="bg-indigo-600 text-white rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%] ml-auto text-right">
                Got it — we cover emergency boiler repairs same day. What&apos;s your postcode? I&apos;ll check availability now.
              </div>
            </div>
            <p className="text-slate-600 text-xs text-center mt-4">
              Replied in 4 seconds · Fully automated
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
            { value: "100%", label: "Missed calls followed up" },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-white font-bold text-2xl">{stat.value}</p>
              <p className="text-slate-400 text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="bg-white py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-indigo-600 text-sm font-semibold uppercase tracking-widest mb-3">
              How it works
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
              Set up in 10 minutes. Works forever.
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                icon: "📞",
                title: "You miss a call",
                description:
                  "A customer calls your business number. You're on the job, with a client, or it's 11pm on a Sunday.",
              },
              {
                step: "02",
                icon: "💬",
                title: "Remy texts back instantly",
                description:
                  "Within seconds, Remy sends a personalised SMS reply. It answers questions, qualifies the lead, and keeps the conversation going.",
              },
              {
                step: "03",
                icon: "✅",
                title: "You close the job",
                description:
                  "Check your inbox when you're free. The conversation is waiting. Reply manually or let Remy keep going — your choice.",
              },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 h-full">
                  <p className="text-slate-300 font-bold text-4xl mb-4 font-mono">
                    {item.step}
                  </p>
                  <div className="text-3xl mb-3">{item.icon}</div>
                  <h3 className="text-slate-900 font-semibold text-lg mb-2">
                    {item.title}
                  </h3>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHO IT'S FOR ── */}
      <section className="bg-slate-50 border-y border-slate-200 py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-indigo-600 text-sm font-semibold uppercase tracking-widest mb-3">
            Who it&apos;s for
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight mb-4">
            Built for businesses that answer the phone
          </h2>
          <p className="text-slate-500 text-lg mb-12 max-w-xl mx-auto">
            If you run a service business and miss calls when you&apos;re busy, Remy
            pays for itself with the first job it saves.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { icon: "🔧", label: "Plumbers" },
              { icon: "⚡", label: "Electricians" },
              { icon: "✂️", label: "Salons" },
              { icon: "🦷", label: "Dental practices" },
              { icon: "🏠", label: "Estate agents" },
              { icon: "🔑", label: "Locksmiths" },
              { icon: "🚗", label: "Garages" },
              { icon: "🛁", label: "Bathroom fitters" },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-white border border-slate-200 rounded-xl px-4 py-4 text-center"
              >
                <div className="text-2xl mb-1">{item.icon}</div>
                <p className="text-slate-700 text-sm font-medium">{item.label}</p>
              </div>
            ))}
          </div>
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
            Less than the cost of one missed job per month.
          </p>

          <div className="bg-slate-950 rounded-2xl p-8 text-left shadow-xl ring-1 ring-indigo-500/30">
            <PricingPrice />
            <p className="text-slate-400 text-sm mb-8">
              Billed monthly · Cancel anytime
            </p>

            <ul className="space-y-3 mb-8">
              {[
                "Remy AI receptionist — always on",
                "Instant missed-call SMS replies",
                "AI replies to inbound messages",
                "Unified conversation inbox",
                "Contact management",
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
              Start your 14-day free trial
            </a>
            <p className="text-slate-500 text-xs text-center mt-3">
              No credit card required to start
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA STRIP ── */}
      <section className="bg-indigo-600 py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
            The next missed call could be your best customer
          </h2>
          <p className="text-indigo-200 text-lg mb-8">
            Get Remy working for your business in under 10 minutes.
          </p>
          <a
            href="/signup"
            className="inline-block bg-white text-indigo-700 font-semibold px-8 py-3.5 rounded-lg hover:bg-indigo-50 transition-colors text-base"
          >
            Start free trial — no card needed
          </a>
        </div>
      </section>

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
