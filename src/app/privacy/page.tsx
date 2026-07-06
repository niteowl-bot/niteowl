import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — NiteOwl AI",
  description: "How NiteOwl AI collects, uses, and protects data across Remy, the AI receptionist platform.",
};

const LAST_UPDATED = "6 July 2026";

export default function PrivacyPolicyPage() {
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
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-slate-500 text-sm mb-12">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-10 leading-relaxed text-[15px]">
          <section>
            <p>
              NiteOwl AI Ltd (&ldquo;<strong className="text-white">NiteOwl</strong>&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;)
              provides Remy, an AI receptionist that answers customer enquiries, books appointments, and
              captures leads on behalf of the businesses that use it (&ldquo;
              <strong className="text-white">Customers</strong>&rdquo;). This policy explains what
              information we collect, how we use it, and the rights you have over it.
            </p>
            <p className="mt-3">
              This policy covers three groups of people: visitors to our website
              (niteowlhq.com), Customers who sign up for and manage a Remy account, and{" "}
              <strong className="text-white">End Users</strong> — the customers of our
              Customers, who interact with Remy through a website chat widget or NiteOwl&rsquo;s
              own marketing site.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">1. Information we collect</h2>

            <h3 className="text-white font-medium mt-5 mb-2">From Customers (business accounts)</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Name and email address, and password or Google account details if you sign in with Google</li>
              <li>Business details you provide: business name, type, description, website, opening hours, and knowledge base content</li>
              <li>Billing information — handled directly by our payment processor, Stripe; we never receive or store your card details ourselves</li>
              <li>Records of your own use of the dashboard, such as leads, bookings, and conversation history</li>
            </ul>

            <h3 className="text-white font-medium mt-5 mb-2">From End Users (customers chatting with Remy)</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Name, email address, and/or phone number, where you choose to provide them in a conversation</li>
              <li>The content of your messages, including any service requested and your preferred appointment time</li>
              <li>Appointment and booking details, where you book, reschedule, or cancel a service</li>
            </ul>

            <h3 className="text-white font-medium mt-5 mb-2">Collected automatically</h3>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Basic technical data (such as IP address) used briefly to prevent abuse of our chat and booking systems — this is not linked to your identity or stored long-term</li>
              <li>Error and performance diagnostics, collected via Sentry, to help us detect and fix bugs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">2. How we use information</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To operate Remy: answering enquiries, checking availability, and booking, rescheduling, or cancelling appointments</li>
              <li>To notify a Customer&rsquo;s business when a new lead, booking, or enquiry needs their attention</li>
              <li>To send transactional emails: booking confirmations, cancellation/reschedule notices, and account-related messages</li>
              <li>To operate and improve NiteOwl&rsquo;s own product and marketing site, including our sales chat assistant</li>
              <li>To provide customer support, and to detect, investigate, and prevent abuse or security issues</li>
              <li>To process payments and manage subscriptions, via Stripe</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">3. AI processing</h2>
            <p>
              Remy&rsquo;s responses are generated using OpenAI&rsquo;s language models. When you chat with
              Remy — whether as an End User on a Customer&rsquo;s website, through NiteOwl&rsquo;s own sales
              chat, or as a Customer testing your own assistant — the content of that conversation is sent to
              OpenAI&rsquo;s API to generate a reply and, where relevant, to identify booking details such as a
              name, contact method, or requested time. We do not use this content to train OpenAI&rsquo;s models,
              and OpenAI processes it under its own API data usage terms, which do not permit training on
              API-submitted content by default.
            </p>
            <p className="mt-3">
              Remy is designed to escalate anything it cannot confidently answer to a real person at the
              relevant business, rather than guess. It does not make medical, legal, financial, or emergency
              decisions, and should not be relied on for any of these.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">4. Who we share information with</h2>
            <p>We share information only with the service providers who help us run NiteOwl, and only as needed to provide the service:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li><strong className="text-white">Supabase</strong> — database hosting and account authentication</li>
              <li><strong className="text-white">OpenAI</strong> — generating chat responses and extracting booking details, as above</li>
              <li><strong className="text-white">Resend</strong> — delivering transactional emails</li>
              <li><strong className="text-white">Stripe</strong> — processing subscription payments</li>
              <li><strong className="text-white">Vercel</strong> — application hosting</li>
              <li><strong className="text-white">Sentry</strong> — error monitoring and diagnostics</li>
            </ul>
            <p className="mt-3">
              A Customer using Remy can see the enquiries, leads, and bookings that come through their own
              account — that is the core function of the product. We do not sell personal information to
              anyone, and we do not share it with third parties for their own marketing purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">5. International data transfers</h2>
            <p>
              Some of the service providers listed above may process data outside the UK or European
              Economic Area. Where this happens, we rely on appropriate safeguards required by UK data
              protection law, such as standard contractual clauses, and we choose providers who maintain
              their own equivalent commitments.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">6. Data retention</h2>
            <p>
              We keep Customer account and business data for as long as the account is active, and for a
              reasonable period afterward to allow reactivation and to meet legal or accounting obligations.
              End User conversation, lead, and booking data is retained by the relevant Customer&rsquo;s account
              for as long as that account exists, so the business can maintain its own customer records.
              Technical rate-limiting data is held only briefly, in memory, and is not persisted.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">7. Your rights</h2>
            <p>Depending on where you are located, you may have the right to:</p>
            <ul className="list-disc pl-5 space-y-1.5 mt-3">
              <li>Ask what personal information we hold about you, and request a copy of it</li>
              <li>Ask us to correct inaccurate information</li>
              <li>Ask us to delete your information, subject to any legal or legitimate business reasons we may need to keep it</li>
              <li>Object to, or ask us to restrict, certain processing</li>
              <li>Withdraw consent at any time, where we rely on consent</li>
            </ul>
            <p className="mt-3">
              If you are an End User and want to exercise these rights, you can contact the business you
              spoke with directly, or contact us and we will help route your request. Customers can access,
              export, or delete most of their own account data directly from the dashboard, or by contacting
              us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">8. Security</h2>
            <p>
              We use industry-standard measures to protect information, including encryption in transit,
              access controls restricting who can view Customer data, and row-level security on our database
              so one Customer&rsquo;s data is never visible to another. No method of transmission or storage is
              completely secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">9. Cookies</h2>
            <p>
              We use only the essential cookies needed to keep you signed in to your account. We do not use
              third-party advertising or analytics cookies on niteowlhq.com.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">10. Children&rsquo;s privacy</h2>
            <p>
              Remy and NiteOwl&rsquo;s services are intended for business use and are not directed at children.
              We do not knowingly collect personal information from children.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">11. Changes to this policy</h2>
            <p>
              We may update this policy as NiteOwl and Remy evolve. We&rsquo;ll update the date at the top of
              this page when we do, and where changes are significant, we&rsquo;ll take reasonable steps to let
              Customers know.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-3">12. Contact us</h2>
            <p>
              Questions about this policy or your data can be sent to{" "}
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
          <Link href="/terms" className="hover:text-white transition-colors">
            Terms of Service
          </Link>
        </div>
      </footer>
    </div>
  );
}
