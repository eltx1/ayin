import type { Metadata } from "next";

import { LegalNotice, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of AYIN viewing, creator, community and monetization features.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          These Terms govern access to and use of AYIN, a Horus Media product. By creating an
          account, uploading content or continuing to use AYIN, you agree to these Terms and the
          policies linked from them.
        </p>
      }
    >
      <LegalSection title="1. Eligibility and accounts">
        <p>
          You must be at least 13 years old to create an AYIN account. If the law where you live
          requires a higher age to consent to online services, you must meet that age or use AYIN
          with the involvement and permission of a parent or legal guardian where permitted. You
          must provide accurate account information, protect your credentials and promptly report
          suspected unauthorized access.
        </p>
      </LegalSection>

      <LegalSection title="2. The AYIN service">
        <p>
          AYIN provides streaming, creator channels, uploads, playlists, Creator TV, Clips,
          community features, recommendations, administration and related services. Features may be
          introduced, changed, suspended or removed as the platform evolves. Beta, experimental,
          live, advertising, monetization or device-specific features may have additional limits or
          may not be available to every user.
        </p>
      </LegalSection>

      <LegalSection title="3. Your content and ownership">
        <p>
          You retain ownership of copyrights and other rights you hold in content you upload. You
          are responsible for ensuring you have all rights, licenses, permissions and consents
          necessary to upload, publish, monetize and distribute that content through AYIN.
        </p>
        <p>
          By uploading or publishing content, you grant AYIN a worldwide, non-exclusive,
          royalty-free license to host, store, reproduce, transmit, display, perform, format,
          technically adapt and distribute that content solely as reasonably necessary to operate,
          promote and improve AYIN and the creator&apos;s use of the service. This license ends when
          the content is deleted from active service, subject to reasonable backup, legal,
          moderation and technical retention.
        </p>
      </LegalSection>

      <LegalSection title="4. Content you may not upload">
        <p>You may not upload or distribute content that:</p>
        <ul>
          <li>infringes copyright, trademark, privacy, publicity or other rights;</li>
          <li>is unlawful, fraudulent, malicious or designed to facilitate serious wrongdoing;</li>
          <li>contains sexual exploitation of minors or other illegal exploitative material;</li>
          <li>
            contains prohibited hateful, violent, harassing or deceptive conduct under AYIN&apos;s
            Community Guidelines;
          </li>
          <li>
            contains malware, credential theft, spam or attempts to compromise AYIN or other users;
          </li>
          <li>falsely claims ownership, licensing, sponsorship or endorsement.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Public-domain and licensed material">
        <p>
          Marking a work as public domain, licensed or authorized is a factual declaration by the
          uploader, not a transfer of verification responsibility to AYIN. You must preserve
          required attribution, license notices, ShareAlike terms or other conditions and consider
          separate rights such as trademarks, privacy and publicity rights. AYIN may request
          supporting provenance or remove material where the rights basis is unclear.
        </p>
      </LegalSection>

      <LegalSection title="6. Community conduct">
        <p>
          You must follow the Community Guidelines when commenting, posting, reporting, messaging
          support or interacting with creators and viewers. Do not manipulate engagement, abuse
          reporting systems, impersonate others, evade enforcement or interfere with the service.
        </p>
      </LegalSection>

      <LegalSection title="7. Moderation and enforcement">
        <p>
          AYIN may review reports, restrict reach, disable comments, unpublish or remove content,
          suspend channels or accounts, preserve evidence and take other proportionate action to
          enforce these Terms, protect users or comply with law. Where the product supports it,
          creators may receive notices or appeal certain moderation decisions. Serious or repeated
          violations may result in immediate action.
        </p>
      </LegalSection>

      <LegalSection title="8. Advertising and monetization">
        <p>
          AYIN may display house, direct or third-party advertising around or within eligible
          content. Creator monetization is not automatic. Eligibility, revenue share, ad inventory,
          estimated earnings, final earnings, adjustments, payout thresholds, compliance and payment
          methods may be governed by separate creator terms or contracts.
        </p>
        <p>
          Estimated analytics or revenue are not a promise of payment. AYIN may correct invalid,
          duplicated, fraudulent or subsequently adjusted advertising and revenue data consistent
          with applicable agreements and records.
        </p>
      </LegalSection>

      <LegalSection title="9. Copyright notices and takedowns">
        <p>
          Rights holders may submit notices under AYIN&apos;s Copyright & Takedown Policy. Users
          must not knowingly submit false notices or counter-notices. AYIN may retain notices and
          related records as needed for legal compliance, repeat-infringer enforcement and dispute
          handling.
        </p>
      </LegalSection>

      <LegalSection title="10. Security and prohibited technical conduct">
        <p>
          You may not probe, bypass, overload or interfere with authentication, rate controls,
          security systems, advertising measurement, access restrictions, APIs or infrastructure;
          scrape private data; introduce malicious code; or use automated access in a way that
          materially burdens AYIN or violates these Terms.
        </p>
      </LegalSection>

      <LegalSection title="11. Service availability and changes">
        <p>
          AYIN is provided on an evolving basis. We work to keep the service available but do not
          guarantee uninterrupted operation, permanent availability of any content, or compatibility
          with every device or network. Maintenance, security incidents, provider failures or legal
          requirements may temporarily affect service.
        </p>
      </LegalSection>

      <LegalSection title="12. Disclaimers and liability">
        <p>
          To the maximum extent permitted by law, AYIN is provided on an “as available” basis
          without warranties that cannot legally be disclaimed. Horus Media and AYIN are not liable
          for indirect, incidental, special, consequential or punitive losses where such exclusions
          are legally permitted. Nothing in these Terms excludes rights or liabilities that cannot
          lawfully be excluded.
        </p>
      </LegalSection>

      <LegalSection title="13. Account suspension and termination">
        <p>
          You may stop using AYIN at any time. AYIN may suspend or terminate access for material or
          repeated violations, fraud, security risks, legal requirements or conduct that threatens
          users or the platform. Certain provisions concerning rights, records, disputes, liability
          and enforcement survive termination where their nature requires it.
        </p>
      </LegalSection>

      <LegalSection title="14. Changes and contact">
        <p>
          These Terms may be updated as AYIN develops. Material changes will be reflected by the
          updated date and, where appropriate, additional notice. Questions may be sent to{" "}
          <a href="mailto:mohamed@horusmedia.net">mohamed@horusmedia.net</a>.
        </p>
      </LegalSection>

      <LegalNotice>
        Creator monetization, payment execution and external advertising are governed by the
        configuration and agreements actually active at the time. AYIN does not invent or imply a
        Google, advertiser or payment relationship before it exists.
      </LegalNotice>
    </LegalPage>
  );
}
