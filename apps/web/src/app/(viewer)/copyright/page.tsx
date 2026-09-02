import type { Metadata } from "next";

import { LegalNotice, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Copyright & Takedown Policy",
  description: "AYIN copyright reporting, counter-notice and repeat-infringer procedures.",
};

export default function CopyrightPolicyPage() {
  return (
    <LegalPage
      title="Copyright & Takedown Policy"
      intro={
        <p>
          AYIN respects copyright and expects creators to upload only material they own or are
          authorized to use. This policy explains how rights holders can report alleged
          infringement and how creators can respond when content is removed or restricted.
        </p>
      }
    >
      <LegalSection title="1. Before submitting a notice">
        <p>
          Copyright protects original expression, not every idea, fact, title or concept. Before
          reporting content, consider whether the use is authorized by the rights holder, licensed,
          in the public domain, or permitted by an applicable legal exception such as fair use or
          fair dealing. AYIN cannot provide legal advice or decide private ownership disputes beyond
          what is reasonably necessary to operate the service.
        </p>
      </LegalSection>

      <LegalSection title="2. Copyright infringement notices">
        <p>A useful notice should identify:</p>
        <ul>
          <li>the copyrighted work claimed to have been infringed;</li>
          <li>the AYIN URL, video, channel or other material to be reviewed;</li>
          <li>the reporting party&apos;s name and reliable contact information;</li>
          <li>the basis for the reporting party&apos;s authority to act for the rights holder;</li>
          <li>a good-faith statement that the disputed use is not authorized by the rights holder, its agent or applicable law;</li>
          <li>a statement that the information in the notice is accurate and, where applicable law requires it, made under penalty of perjury;</li>
          <li>a physical or electronic signature where legally required.</li>
        </ul>
        <p>
          Send legal copyright notices to{" "}
          <a href="mailto:mohamed@horusmedia.net">mohamed@horusmedia.net</a>. Signed-in users may
          also use AYIN&apos;s reporting tools where available. Please provide direct AYIN URLs rather
          than search terms or screenshots alone.
        </p>
      </LegalSection>

      <LegalSection title="3. What AYIN may do after receiving a notice">
        <p>
          AYIN may request clarification, preserve relevant records, restrict or remove material,
          notify the uploader, record a moderation or rights case, or decline a notice that lacks
          enough information to identify the work or allegedly infringing material. Actions may
          differ by jurisdiction and by the legal process that applies to a particular notice.
        </p>
      </LegalSection>

      <LegalSection title="4. Counter-notices and disputes">
        <p>
          If you believe material was removed or disabled because of a mistake or
          misidentification, you may respond with the information required by the applicable legal
          process. A counter-notice should clearly identify the removed material, explain the basis
          for your claim, provide reliable contact information and include any declarations,
          jurisdictional consent or signature required by law. AYIN may forward a valid
          counter-notice to the original claimant when legally appropriate.
        </p>
      </LegalSection>

      <LegalSection title="5. Repeat infringement">
        <p>
          AYIN may issue warnings, strikes, restrictions or account/channel suspension for repeated
          or serious copyright infringement. We may consider the number, reliability and outcome of
          notices; counter-notices; retractions; court orders; the user&apos;s history; and other relevant
          circumstances. Abuse of the copyright process, including knowingly false notices or
          counter-notices, may also result in action.
        </p>
      </LegalSection>

      <LegalSection title="6. Public domain and open licenses">
        <p>
          A public-domain or open-license label is not enough by itself. Uploaders must verify the
          status of the specific item they use and comply with attribution, notice, ShareAlike or
          other license conditions. Separate rights such as trademarks, publicity, privacy, music,
          performances or underlying works may still apply even when a particular recording or file
          is freely reusable.
        </p>
      </LegalSection>

      <LegalSection title="7. Preservation and disclosure">
        <p>
          AYIN may retain notices, counter-notices, rights declarations, moderation records and
          related evidence for legal compliance, repeat-infringer administration, fraud prevention
          and dispute resolution. Information may be disclosed when required by law or reasonably
          necessary to process a valid rights claim.
        </p>
      </LegalSection>

      <LegalNotice>
        Do not submit a copyright notice merely because you dislike, compete with or disagree with
        content. False rights claims can harm creators and may carry legal consequences.
      </LegalNotice>
    </LegalPage>
  );
}
