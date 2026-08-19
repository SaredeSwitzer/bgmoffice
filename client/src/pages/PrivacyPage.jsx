// Public privacy policy — no auth. Reachable at /privacy so the 10DLC campaign can link to it
// (carrier review requires a public page with SMS no-sell/no-share language). Standalone layout,
// no NavShell. Source copy lives in sarede/telnyx/privacy-policy.md; keep the two in sync.

const EFFECTIVE_DATE = 'August 19, 2026'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <header className="mb-8 border-b border-gray-200 pb-6">
          <h1 className="text-2xl font-semibold">Privacy Policy</h1>
          <p className="mt-1 text-sm text-gray-500">Bring the Gym to Me</p>
          <p className="mt-1 text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>
        </header>

        <div className="space-y-6 text-sm leading-relaxed text-gray-700">
          <p>
            Bring the Gym to Me (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) respects your
            privacy. This policy explains what information we collect, how we use it, and the choices
            you have &mdash; including for text (SMS) messages.
          </p>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-900">Information we collect</h2>
            <p>
              When you become a client or enquire about our services, we may collect your name, phone
              number, email address, and information needed to schedule and deliver personal-training
              sessions. We collect this only when you give it to us directly (in person, by phone, by
              email, or through our website).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-900">How we use your information</h2>
            <p>
              We use your information to schedule sessions, send you appointment and class reminders,
              respond to your questions, process payments, and provide our services. We do not use
              your information for any purpose you have not agreed to.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-900">Text messaging (SMS)</h2>
            <p>
              If you provide your mobile number and agree to receive text messages, we may send you
              appointment and class reminders and related account/service notifications. Message
              frequency varies. <strong>Message and data rates may apply.</strong> You can opt out at
              any time by replying <strong>STOP</strong>, and you can get help by replying{' '}
              <strong>HELP</strong> or contacting us at the email below.
            </p>
            <p className="mt-3">
              <strong>
                We do not sell, rent, or share your mobile phone number or SMS opt-in information with
                any third party for their own marketing purposes.
              </strong>{' '}
              Mobile information collected for SMS is used only to deliver the messages you asked for
              and is not shared with third parties or affiliates for marketing or promotional
              purposes. We may share limited information with service providers who help us send
              messages or run our business (for example, our messaging provider), only as needed to
              provide the service and under an obligation to keep it confidential.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-900">Data retention and security</h2>
            <p>
              We keep your information only as long as needed to provide our services and meet legal
              requirements, and we take reasonable steps to protect it.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-900">Your choices</h2>
            <p>
              You may ask us to update or delete your information, or stop contacting you, at any time.
              To opt out of texts, reply STOP. For anything else, contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-gray-900">Contact us</h2>
            <p className="not-italic">
              Bring the Gym to Me<br />
              Email:{' '}
              <a className="text-gray-900 underline" href="mailto:sarede@bringthegymtome.com">
                sarede@bringthegymtome.com
              </a>
              <br />
              346 New York Ave, 5A, Brooklyn, NY 11213
            </p>
          </section>

          <p className="border-t border-gray-200 pt-6 text-xs text-gray-500">
            We may update this policy from time to time; the effective date above shows the latest
            version.
          </p>
        </div>
      </div>
    </div>
  )
}
