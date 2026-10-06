import type { ProductControls } from "./admin-product";

export type TaxonomyItem = ProductControls["taxonomy"][number];
export type ProductControlsIssue =
  | "announcementText"
  | "announcementHref"
  | "taxonomyLimit"
  | "taxonomyLabel"
  | "taxonomyKey"
  | "taxonomyDuplicate";

// Labels are content, not identifiers. In particular, Arabic text, commas and
// a temporarily empty label must survive editing without changing other rows.
export function updateTaxonomyLabel(
  taxonomy: TaxonomyItem[],
  index: number,
  label: string,
): TaxonomyItem[] {
  return taxonomy.map((item, position) => (position === index ? { ...item, label } : item));
}

export function appendTaxonomyItem(taxonomy: TaxonomyItem[]): TaxonomyItem[] {
  if (taxonomy.length >= 100) return taxonomy;
  const keys = new Set(taxonomy.map((item) => item.key));
  let index = 1;
  while (keys.has(`category-${index}`)) index++;
  return [...taxonomy, { key: `category-${index}`, label: "", enabled: true }];
}

export function validateProductControlsDraft(
  controls: ProductControls,
): ProductControlsIssue | null {
  const announcement = controls.announcement;
  if (
    announcement.text.trim().length > 240 ||
    (announcement.enabled && announcement.text.trim().length === 0)
  )
    return "announcementText";
  // A leading slash alone also accepts protocol-relative URLs. This editor
  // promises an internal destination, so require a single slash and no slashes
  // disguised as backslashes or whitespace/control characters.
  if (
    announcement.href !== null &&
    (!announcement.href.startsWith("/") ||
      announcement.href.startsWith("//") ||
      /[\\\s\u0000-\u001f\u007f]/u.test(announcement.href) ||
      announcement.href.length > 160)
  )
    return "announcementHref";
  if (controls.taxonomy.length > 100) return "taxonomyLimit";
  if (controls.taxonomy.some((item) => !item.label.trim() || item.label.trim().length > 80))
    return "taxonomyLabel";
  if (controls.taxonomy.some((item) => !/^[a-z0-9_-]{1,60}$/.test(item.key))) return "taxonomyKey";
  if (new Set(controls.taxonomy.map((item) => item.key)).size !== controls.taxonomy.length)
    return "taxonomyDuplicate";
  return null;
}

export function productControlsIssueMessage(issue: ProductControlsIssue, locale: string): string {
  const messages = {
    announcementText: [
      "Enter announcement text before enabling it (up to 240 characters).",
      "أدخل نص الإعلان قبل تفعيله (حتى 240 حرفًا).",
    ],
    announcementHref: [
      "Use an internal path beginning with one /, up to 160 characters, or leave the link blank.",
      "استخدم مسارًا داخليًا يبدأ بشرطة / واحدة، حتى 160 حرفًا، أو اترك الرابط فارغًا.",
    ],
    taxonomyLimit: ["Use up to 100 categories.", "استخدم حتى 100 تصنيف."],
    taxonomyLabel: [
      "Give every category a label of 1 to 80 characters, or explicitly remove the category.",
      "أدخل اسمًا لكل تصنيف من حرف واحد إلى 80 حرفًا، أو أزل التصنيف صراحةً.",
    ],
    taxonomyKey: [
      "A category has an invalid saved key. Review that category before saving.",
      "يوجد تصنيف بمعرّف محفوظ غير صالح. راجع هذا التصنيف قبل الحفظ.",
    ],
    taxonomyDuplicate: [
      "Some categories have the same saved key. Review those categories before saving.",
      "توجد تصنيفات لها المعرّف المحفوظ نفسه. راجع هذه التصنيفات قبل الحفظ.",
    ],
  } satisfies Record<ProductControlsIssue, [string, string]>;
  return messages[issue][locale === "ar" ? 1 : 0];
}
