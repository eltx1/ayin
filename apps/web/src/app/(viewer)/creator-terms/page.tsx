import type { Metadata } from "next";

import { LegalNotice, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Creator & Content Rights Terms",
  description: "Rights, licensing, monetization and publishing responsibilities for AYIN creators.",
};

export default function CreatorTermsPage() {
  return (
    <LegalPage
      title="Creator & Content Rights Terms"
      intro={
        <p>
          These terms supplement AYIN&apos;s Terms of Service for anyone who publishes video, Clips,
          community material or other creator content. They are designed to keep ownership clear,
          protect rights holders and make future advertising and creator monetization transparent.
        </p>
      }
    >
      <LegalSection title="1. You keep ownership">
        <p>
          AYIN does not take ownership of content merely because you upload it. You keep the rights
          you hold, subject to the operational license granted in AYIN&apos;s Terms of Service and
          any separate agreement you intentionally enter into with AYIN or another rights holder.
        </p>
      </LegalSection>

      <LegalSection title="2. You must have a valid rights basis">
        <p>
          For each publication, you must be able to rely on at least one legitimate basis, such as:
        </p>
        <ul>
          <li>you created and own the relevant rights;</li>
          <li>you received a license that covers the intended AYIN use;</li>
          <li>you received authorization from the relevant rights holder;</li>
          <li>
            the specific work is genuinely in the public domain in the territory and use at issue;
          </li>
          <li>another lawful basis applies and you can explain it if challenged.</li>
        </ul>
        <p>
          AYIN may ask for source notes, licenses, attribution information, contracts or other
          provenance before or after publication.
        </p>
      </LegalSection>

      <LegalSection title="3. Open-license and public-domain content">
        <p>
          Open licenses are not interchangeable. If a work requires attribution, license notices,
          ShareAlike distribution or other conditions, you must satisfy them. A non-commercial
          license may not be appropriate where AYIN or the creator uses the content in an
          advertising-supported or otherwise commercial context. Avoid uploading a work when the
          license or public-domain status is ambiguous.
        </p>
      </LegalSection>

      <LegalSection title="4. Music, performances and layered rights">
        <p>
          A video can contain multiple separate rights. Ownership of footage does not automatically
          grant rights to music, performances, artwork, brands, scripts, photographs or underlying
          works incorporated into it. Creators are responsible for clearing the rights needed for
          the actual publication and monetization they request.
        </p>
      </LegalSection>

      <LegalSection title="5. Thumbnails, titles and metadata">
        <p>
          Creator metadata must not falsely identify the rights holder, source, participants,
          sponsorship or subject of content. Thumbnails and promotional images are content too and
          must be owned, licensed, authorized or otherwise lawful.
        </p>
      </LegalSection>

      <LegalSection title="6. Monetization eligibility">
        <p>
          Publishing on AYIN does not guarantee eligibility for advertising or revenue share.
          Monetization may depend on rights status, content quality, policy compliance, advertiser
          suitability, account standing, contractual terms, tax/compliance information and the
          availability of eligible advertising demand.
        </p>
        <p>
          AYIN may disable advertising on particular content without removing that content from the
          service. Creator revenue percentages and payout rules become binding only when explicitly
          configured or agreed for the creator/channel; safe platform defaults do not create a
          payment promise.
        </p>
      </LegalSection>

      <LegalSection title="7. Advertising-related responsibilities">
        <p>
          Creators must not click their own ads, encourage invalid interaction, purchase artificial
          traffic, conceal prohibited traffic sources or interfere with advertising measurement.
          Sponsored or commercially influenced creator content must include disclosures required by
          applicable law and platform policy.
        </p>
      </LegalSection>

      <LegalSection title="8. Removal, disputes and records">
        <p>
          Content may be limited or removed while a rights claim is investigated. AYIN may preserve
          rights declarations, source notes, notices, counter-notices and audit records. A creator
          who repeatedly uploads material without a defensible rights basis may lose publishing or
          monetization privileges.
        </p>
      </LegalSection>

      <LegalSection title="9. Creator TV, discovery and technical formatting">
        <p>
          Eligible published content may appear in the creator&apos;s Uploads playlist, Creator TV,
          recommendations, search, Clips feeds or other AYIN discovery surfaces according to the
          creator&apos;s settings and platform controls. AYIN may technically format metadata,
          generate application views or adapt delivery as needed to operate compatible devices,
          without changing ownership of the underlying content.
        </p>
      </LegalSection>

      <LegalSection title="10. Contact and support">
        <p>
          Use AYIN support for creator account or policy questions. Rights and legal questions may
          also be sent to <a href="mailto:mohamed@horusmedia.net">mohamed@horusmedia.net</a>.
        </p>
      </LegalSection>

      <LegalNotice>
        When in doubt about a third-party work, do not upload it merely because it can be downloaded
        from the internet. Verify the specific item&apos;s rights statement and preserve the
        evidence.
      </LegalNotice>
    </LegalPage>
  );
}
