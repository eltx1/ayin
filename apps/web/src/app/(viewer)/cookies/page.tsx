import type { Metadata } from "next";

import { LegalNotice, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Cookie & Advertising Notice",
  description: "How AYIN uses essential browser storage, analytics and advertising technologies.",
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie & Advertising Notice"
      intro={
        <p>
          This notice explains the browser storage, session, analytics and advertising technologies
          AYIN uses or is designed to support. It should be read with the Privacy Policy.
        </p>
      }
    >
      <LegalSection title="1. Essential technologies">
        <p>
          AYIN uses essential cookies or equivalent browser mechanisms to maintain authenticated
          sessions, protect account actions, remember application state and provide security. These
          technologies are necessary for requested service functions and are not used merely to
          create an advertising profile.
        </p>
      </LegalSection>

      <LegalSection title="2. First-party product analytics">
        <p>
          AYIN may record first-party events such as page views, playback progress, searches,
          uploads, social interactions, Creator TV activity and advertising events. AYIN&apos;s analytics
          design uses bounded event collection and pseudonymous identifiers where appropriate to
          understand product reliability and performance.
        </p>
      </LegalSection>

      <LegalSection title="3. Advertising technologies">
        <p>
          AYIN is designed to support Google Ad Manager, Google Publisher Tag and Google IMA as well
          as AYIN-operated house or direct advertising. When third-party advertising is activated,
          approved providers may use cookies, IP addresses, device or advertising identifiers and
          similar technologies for ad delivery, frequency control, fraud prevention, measurement
          and reporting, subject to applicable consent requirements.
        </p>
      </LegalSection>

      <LegalSection title="4. Personalized, non-personalized and limited ads">
        <p>
          Advertising treatment may vary based on consent, age-related rules, product configuration
          and legal requirements. Where applicable, AYIN can request personalized, non-personalized
          or limited-ad treatment from supported advertising integrations. Child-directed treatment
          and under-age-of-consent signals must not be used to enable behavioral advertising to
          children.
        </p>
      </LegalSection>

      <LegalSection title="5. Consent controls">
        <p>
          Where consent is legally required before optional advertising or storage technologies are
          used, AYIN will present an appropriate consent choice. Before Google personalized
          advertising is enabled in regions where Google requires a certified consent management
          platform, AYIN will deploy an appropriate Google-certified CMP and pass the resulting
          privacy choices to the advertising integration.
        </p>
      </LegalSection>

      <LegalSection title="6. Google information">
        <p>
          When Google advertising services are active, Google may process information according to
          its own policies. Learn more at{" "}
          <a href="https://policies.google.com/technologies/partner-sites">
            How Google uses information from sites or apps that use its services
          </a>.
        </p>
      </LegalSection>

      <LegalSection title="7. Managing browser storage">
        <p>
          Most browsers allow you to inspect, block or delete cookies and site data. Blocking
          essential storage may prevent login, account actions, playback preferences or other AYIN
          functionality from working correctly. Optional consent choices, when applicable, will be
          offered separately from essential service storage.
        </p>
      </LegalSection>

      <LegalSection title="8. Changes">
        <p>
          We may update this notice as AYIN activates new analytics, advertising or consent
          capabilities. The updated date will change when material revisions are made.
        </p>
      </LegalSection>

      <LegalNotice>
        AYIN&apos;s Google Ad Manager production mode remains subject to real account configuration,
        authorized seller records and required privacy/consent controls. This notice does not claim
        that personalized Google advertising is active before those launch gates are completed.
      </LegalNotice>
    </LegalPage>
  );
}
