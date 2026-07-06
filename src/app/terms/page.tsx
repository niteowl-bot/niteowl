import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — NiteOwl AI",
  description: "The terms that govern use of NiteOwl AI's Remy AI receptionist platform.",
};

const LAST_UPDATED = "6 July 2026";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans">
      <nav className="border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-white font-bold text-xl tracking-tight">
            niteowl<span className="text-indigo-400">.</span>
          </Link>
          <Link href="/" className="text-slate-400 hover:text-white text-sm transition-colors">
            ← Back to home
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-2">Terms of Service</h1>
        <p className="text-slate-500 text-sm mb-12">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-10 leading-relaxed text-[15px]">
          <section>
            <p>
              These terms govern use of Remy and the NiteOwl AI platform (together, the
              &ldquo;<strong className="text-white">Service</strong>&rdquo;), provided by NiteOwl AI Ltd
              (&ldquo;<strong className="text-white">NiteOwl</strong>&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;).
              By creating an account or using the Service, you (&ldquo;
              <strong className="text-white">Customer</strong>&rdquo;, &ldquo;you&rdquo;) agree to these terms.
              If you are agreeing on behalf of a business, you confirm you have the authority to do so.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. The Service</h2>
            <p>
              Remy is an AI receptionist that answers customer enquiries, books appointments, captures leads,
              and hands off anything it cannot confidently handle to a member of your team. The Service
              includes the dashboard, the website chat widget embedded on your own site, and any related
              features we make available from time to time.
            </p>
            <p className="mt-3">
              NiteOwl is an early-stage product. Features, pricing, and behaviour may change as we develop
              the Service, and during an alpha or beta period we may make changes more frequently and with
              less notice than once the product reaches general availability.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. Accounts</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>You must provide accurate information when creating an account, and keep your login credentials secure</li>
              <li>You are responsible for activity that happens under your account</li>
              <li>You must be legally able to enter into a binding contract to use the Service</li>
              <li>Tell us promptly if you believe your account has been compromised</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. Free trial and billing</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>New accounts receive a 14-day free trial. No payment card is required to start a trial</li>
              <li>If you subscribe to a paid plan, billing is handled by Stripe; by subscribing you also agree to Stripe&rsquo;s own terms for the payment method you use</li>
              <li>Subscriptions renew automatically until cancelled. You can cancel at any time from the billing portal in your dashboard, and cancellation takes effect at the end of the current billing period</li>
              <li>If a subscription lapses or a trial ends without payment, Remy will pause answering enquiries for that account until billing is resolved</li>
              <li>Fees are shown in the currency and amount presented at checkout and are subject to change with reasonable notice</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Acceptable use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>Break any applicable law, or the rights of any person</li>
              <li>Send unlawful, deceptive, harassing, or abusive content through Remy or the widget</li>
              <li>Attempt to disrupt, overload, or gain unauthorised access to the Service or any account other than your own</li>
              <li>Reverse engineer, scrape, or resell the Service without our written permission</li>
              <li>Use the Service to make automated decisions with legal or similarly significant effects on a person without appropriate human review</li>
            </ul>
            <p className="mt-3">
              We may suspend or terminate accounts that we reasonably believe violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. Your content and your customers&rsquo; data</h2>
            <p>
              You&rsquo;re responsible for the accuracy of the business information and knowledge base content
              you provide to Remy, and for having a lawful basis to collect and process the personal
              information of your own customers (&ldquo;End Users&rdquo;) who interact with Remy on your
              behalf — including giving them any privacy notice required by law. NiteOwl processes End User
              data on your behalf as described in our{" "}
              <Link href="/privacy" className="text-indigo-400 hover:text-indigo-300">Privacy Policy</Link>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. AI-generated responses</h2>
            <p>
              Remy&rsquo;s replies are generated by AI models and, while designed to be accurate and to
              escalate anything uncertain to a human, may occasionally be incomplete, out of date, or wrong.
              You&rsquo;re responsible for reviewing the knowledge base you configure and for confirming any
              booking, pricing, or policy details that matter to your business. Remy is not a substitute for
              professional, medical, legal, financial, or emergency advice or services, and must not be relied
              on as one.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Third-party services</h2>
            <p>
              The Service relies on third-party providers, including OpenAI (AI processing), Stripe
              (payments), Supabase (hosting and data storage), Resend (email delivery), Vercel (application
              hosting), and Sentry (error monitoring). Their availability and performance can affect the
              Service, and we are not responsible for outages or issues caused solely by a third-party
              provider outside our reasonable control.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Intellectual property</h2>
            <p>
              NiteOwl and its licensors own the Service, including the Remy product, software, and branding.
              You keep ownership of the business content you provide us (your knowledge base, business
              details, and similar). You grant us a licence to use that content solely to provide the Service
              to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Availability</h2>
            <p>
              We aim to keep the Service available and reliable, but we don&rsquo;t guarantee uninterrupted or
              error-free operation, particularly during the alpha/early-access period. We may need to suspend
              access for maintenance, updates, or issues affecting the Service or its underlying providers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Limitation of liability</h2>
            <p>
              To the fullest extent permitted by law, NiteOwl is not liable for indirect, incidental, or
              consequential losses arising from your use of the Service, including lost profits or lost
              business, and our total liability for any claim relating to the Service is limited to the
              amount you paid us in the 3 months before the claim arose. Nothing in these terms limits
              liability that cannot lawfully be limited, such as liability for fraud or death or personal
              injury caused by negligence.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">11. Termination</h2>
            <p>
              You may stop using the Service and close your account at any time. We may suspend or terminate
              your access if you materially breach these terms, or if required by law. On termination, your
              right to use the Service ends, though some terms (such as intellectual property and liability)
              continue to apply.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">12. Changes to these terms</h2>
            <p>
              We may update these terms as the Service evolves. We&rsquo;ll update the date at the top of this
              page when we do, and where changes are material, we&rsquo;ll take reasonable steps to let you
              know. Continuing to use the Service after changes take effect means you accept the updated
              terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">13. Governing law</h2>
            <p>
              These terms are governed by the laws of England and Wales, and any disputes will be subject to
              the exclusive jurisdiction of the courts of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">14. Contact us</h2>
            <p>
              Questions about these terms can be sent to{" "}
              <a href="mailto:hello@niteowlhq.com" className="text-indigo-400 hover:text-indigo-300">
                hello@niteowlhq.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-800 py-10 px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-sm text-slate-500">
          <span>© {new Date().getFullYear()} Niteowl AI Ltd</span>
          <Link href="/privacy" className="hover:text-white transition-colors">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
