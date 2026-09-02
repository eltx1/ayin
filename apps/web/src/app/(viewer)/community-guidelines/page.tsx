import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Community Guidelines",
  description: "Rules for content, comments, community posts and creator conduct on AYIN.",
};

export default function CommunityGuidelinesPage() {
  return (
    <LegalPage
      title="Community Guidelines"
      intro={
        <p>
          AYIN is built for creators and viewers to publish, discover and discuss video responsibly.
          These Guidelines apply to uploaded media, thumbnails, titles, descriptions, comments,
          community posts, profiles, channels, live-related surfaces and other user-generated
          content.
        </p>
      }
    >
      <LegalSection title="1. Safety and illegal content">
        <p>
          Do not use AYIN to facilitate serious wrongdoing, exploitation, trafficking, terrorism,
          credible threats, dangerous criminal instruction or other illegal activity. Content that
          sexually exploits or endangers minors is prohibited and may be reported to appropriate
          authorities where required.
        </p>
      </LegalSection>

      <LegalSection title="2. Hate, harassment and abuse">
        <p>
          Do not attack or dehumanize people based on protected characteristics, coordinate abusive
          harassment, publish credible threats, expose private personal information to facilitate
          harm, or encourage others to target a person with abuse. Context such as documentary,
          educational, journalistic or counterspeech use may be considered during moderation.
        </p>
      </LegalSection>

      <LegalSection title="3. Sexual and graphic material">
        <p>
          Illegal sexual content, sexual exploitation and sexual content involving minors are never
          allowed. Highly explicit adult sexual material and gratuitous graphic violence may be
          removed or restricted. Documentary, news, medical, artistic or historical context does not
          automatically exempt material from safety restrictions.
        </p>
      </LegalSection>

      <LegalSection title="4. Copyright, ownership and impersonation">
        <p>
          Upload only material you own or are authorized to use. Do not remove required attribution,
          falsely label copyrighted material as public domain, impersonate a creator or
          organization, or imply sponsorship or endorsement that does not exist.
        </p>
      </LegalSection>

      <LegalSection title="5. Spam and manipulation">
        <p>
          Do not post repetitive spam, deceptive links, malware, credential theft, fake giveaways,
          artificial engagement schemes or coordinated manipulation of views, reactions, comments,
          reports, advertising or recommendation systems.
        </p>
      </LegalSection>

      <LegalSection title="6. Misleading and harmful deception">
        <p>
          Do not materially misrepresent the identity, source, rights status or purpose of content
          in a way likely to cause significant harm. Clearly distinguish parody, satire,
          reenactments or materially altered media when context is necessary to avoid harmful
          deception.
        </p>
      </LegalSection>

      <LegalSection title="7. Advertising and commercial conduct">
        <p>
          Commercial content must comply with applicable law and AYIN advertising rules. Do not use
          community features to distribute scams, prohibited products, hidden malicious redirects or
          deceptive financial claims. Creator eligibility for AYIN monetization is separate from the
          right to publish content.
        </p>
      </LegalSection>

      <LegalSection title="8. Reporting and enforcement">
        <p>
          Users may report content through available AYIN reporting tools. AYIN may dismiss reports,
          limit features, hide or remove content, issue warnings or strikes, suspend accounts or
          take other proportionate action. Abuse of reporting tools may itself lead to enforcement.
          Decisions may consider severity, context, intent, recurrence, risk and legal obligations.
        </p>
      </LegalSection>

      <LegalSection title="9. Appeals and repeat violations">
        <p>
          Where an appeal path is available, provide accurate context and rights information. Repeat
          or severe violations may result in stronger action, including account or channel
          suspension. Creating or using another account to evade enforcement is prohibited.
        </p>
      </LegalSection>

      <LegalSection title="10. Questions">
        <p>
          Signed-in users may use AYIN support. Legal or policy questions may also be sent to{" "}
          <a href="mailto:mohamed@horusmedia.net">mohamed@horusmedia.net</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
