import type { Metadata } from "next";

import { LegalNotice, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How AYIN collects, uses, stores and protects information across viewing, creator, advertising and community features.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains how AYIN, a Horus Media product, handles information when you use
          AYIN websites, web/PWA experiences, creator tools, community features and compatible
          applications. It is written for the services AYIN actually operates and for advertising
          capabilities that may be enabled in production over time.
        </p>
      }
    >
      <LegalSection title="1. Information we collect">
        <p>Depending on how you use AYIN, we may process:</p>
        <ul>
          <li>
            Account information such as email address, display name, account status and
            authentication records.
          </li>
          <li>
            Viewer and creator information such as profiles, channels, playlists, subscriptions and
            creator settings.
          </li>
          <li>
            Content and media metadata, including titles, descriptions, rights declarations, file
            size, media type and storage object identifiers.
          </li>
          <li>
            Community activity such as comments, reactions, reports, support requests and moderation
            history.
          </li>
          <li>
            Viewing and product activity such as watch progress, watch history, searches, feature
            interactions and recommendation feedback.
          </li>
          <li>
            Technical information such as device class, browser information, approximate network
            information, security events and service logs.
          </li>
          <li>
            Advertising and monetization events when those features are enabled, such as ad
            requests, impressions, clicks, campaign identifiers and creator revenue records.
          </li>
          <li>
            Creator payout or compliance information when a creator voluntarily enters those
            workflows. Sensitive payout destinations are designed to be stored encrypted.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="2. How we use information">
        <p>We use information to:</p>
        <ul>
          <li>provide accounts, profiles, creator channels, uploads, Creator TV and playback;</li>
          <li>remember viewing progress and personalize relevant discovery features;</li>
          <li>operate comments, community posts, notifications, moderation and user support;</li>
          <li>prevent fraud, abuse, unauthorized access and violations of AYIN policies;</li>
          <li>
            measure reliability, product performance, content performance and creator analytics;
          </li>
          <li>
            operate advertising, revenue attribution and payout records when those systems are
            enabled;
          </li>
          <li>
            comply with legal obligations, enforce agreements and protect users, AYIN and third
            parties.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Cookies, local storage and session technology">
        <p>
          AYIN uses essential browser technologies to maintain authenticated sessions, protect
          account actions and support application features. AYIN may also use first-party product
          analytics identifiers and, when advertising is activated, advertising technologies from
          approved partners. We do not intentionally place secrets in browser-accessible storage.
        </p>
        <p>
          Where law or an advertising partner requires consent, AYIN will present the appropriate
          consent controls before using optional advertising or storage technologies that require
          that consent.
        </p>
      </LegalSection>

      <LegalSection title="4. Google advertising disclosures">
        <p>
          AYIN is designed to support Google Ad Manager, Google Publisher Tag and Google IMA. If
          Google advertising is enabled, Google and other approved advertising technology providers
          may use cookies, web beacons, IP addresses or other identifiers to deliver, limit, measure
          and report advertising.
        </p>
        <p>
          You can read how Google uses information from sites and apps that use its services at{" "}
          <a href="https://policies.google.com/technologies/partner-sites">
            Google&apos;s partner-sites privacy information
          </a>
          .
        </p>
        <p>
          AYIN will not use Google personalized advertising based on information that Google
          classifies as sensitive or on activity known to be from child-directed users or surfaces.
          Before personalized Google ads are enabled in the EEA, UK or Switzerland where Google
          requires it, AYIN will use an appropriate Google-certified consent management platform.
        </p>
      </LegalSection>

      <LegalSection title="5. Media storage and service providers">
        <p>
          Creator media is designed to upload directly from the user&apos;s browser to Cloudflare
          R2. AYIN&apos;s application database stores media metadata and object references rather
          than duplicate copies of creator video bytes. AYIN also uses infrastructure and service
          providers necessary to host, secure, deliver and operate the platform. Providers may
          process information only for the services they supply and subject to their applicable
          terms and safeguards.
        </p>
      </LegalSection>

      <LegalSection title="6. Data sharing">
        <p>We may share information only as reasonably necessary with:</p>
        <ul>
          <li>
            infrastructure, security, storage, email, analytics and advertising providers used to
            operate AYIN;
          </li>
          <li>payment or compliance providers if and when creator payments are activated;</li>
          <li>
            law enforcement, regulators or other parties when required by law or necessary to
            protect rights and safety;
          </li>
          <li>
            a successor or transaction participant if AYIN or relevant business assets are
            reorganized, financed, acquired or transferred.
          </li>
        </ul>
        <p>We do not sell account passwords or private creator media.</p>
      </LegalSection>

      <LegalSection title="7. Retention and deletion">
        <p>
          We retain information for as long as reasonably needed to operate the service, maintain
          security, satisfy legal/accounting obligations, resolve disputes and enforce agreements.
          Retention periods differ by data type. Deleted or removed records may remain for a limited
          period in backups, security logs, financial records or legal-preservation systems where
          deletion is not immediately practical or legally permitted.
        </p>
      </LegalSection>

      <LegalSection title="8. Security">
        <p>
          AYIN uses access controls, encrypted transport, restricted production secrets, password
          hashing, role-based administration, audit records and other technical and organizational
          measures intended to protect information. No internet service can guarantee absolute
          security. Users are responsible for keeping their credentials confidential and reporting
          suspected compromise promptly.
        </p>
      </LegalSection>

      <LegalSection title="9. Children and younger users">
        <p>
          AYIN accounts are not intended to be independently created by children under 13. Where
          local law requires a higher age for independent consent, that higher requirement applies.
          A parent or guardian should supervise use where required. Kids-oriented profiles or
          surfaces do not authorize behavioral advertising to children, and advertising treatment
          must follow applicable child-directed and age-of-consent rules.
        </p>
      </LegalSection>

      <LegalSection title="10. Your choices and rights">
        <p>
          Depending on your location, you may have rights to access, correct, delete, restrict or
          object to certain processing, or to receive a portable copy of certain information. You
          can also manage many account and creator settings inside AYIN. We may need to verify a
          request before acting on it and may retain information where law permits or requires.
        </p>
      </LegalSection>

      <LegalSection title="11. International operation">
        <p>
          AYIN is a global service. Information may be processed in countries other than the one
          where you live. Where required, we use appropriate safeguards for international data
          transfers and apply applicable local legal requirements.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes and contact">
        <p>
          We may update this policy as AYIN changes. Material changes will be reflected by the
          updated date and, where appropriate, additional notice. For privacy or legal questions,
          contact <a href="mailto:mohamed@horusmedia.net">mohamed@horusmedia.net</a>. Signed-in
          users may also use AYIN&apos;s support workflow.
        </p>
      </LegalSection>

      <LegalNotice>
        This policy describes AYIN&apos;s operational privacy commitments. Advertising features that
        require additional consent, account identifiers or external configuration remain disabled
        until those requirements are satisfied.
      </LegalNotice>
    </LegalPage>
  );
}
