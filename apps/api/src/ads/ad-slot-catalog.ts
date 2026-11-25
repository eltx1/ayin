import type { PageAdDevice } from "./page-ad-policy.js";

type Size = [number, number];

export interface PageAdSlotDefinition {
  key: string;
  name: { en: string; ar: string };
  where: { en: string; ar: string };
  routePatterns: string[];
  sizes: Size[];
  responsive: Array<{ minWidth: number; sizes: Size[] }>;
  devices: PageAdDevice[];
}

/**
 * Site-wide slots only appear on pages that carry publisher content. Account, upload, login and
 * support pages stay ad-free (Google publisher policy and a calmer product).
 */
const contentRoutes = [
  "/",
  "/watch/*",
  "/movies*",
  "/series*",
  "/tv*",
  "/creators*",
  "/search*",
  "/c/*",
  "/browse*",
  "/live*",
];

const leaderboard: Pick<PageAdSlotDefinition, "sizes" | "responsive"> = {
  sizes: [
    [970, 90],
    [728, 90],
    [320, 100],
    [320, 50],
  ],
  responsive: [
    {
      minWidth: 768,
      sizes: [
        [970, 90],
        [728, 90],
      ],
    },
    {
      minWidth: 0,
      sizes: [
        [320, 100],
        [320, 50],
      ],
    },
  ],
};

const rectangle: Pick<PageAdSlotDefinition, "sizes" | "responsive"> = {
  sizes: [
    [728, 90],
    [300, 250],
  ],
  responsive: [
    { minWidth: 768, sizes: [[728, 90]] },
    { minWidth: 0, sizes: [[300, 250]] },
  ],
};

/**
 * Every outside-player slot the web interface actually renders. The simple ad manager only
 * offers these keys, so an administrator never configures inventory that has no place on a page.
 * Route patterns are fixed by where the slot is rendered; administrators choose devices and code.
 */
export const pageAdSlotCatalog: readonly PageAdSlotDefinition[] = [
  {
    key: "header_below",
    name: { en: "Below the header", ar: "تحت الهيدر" },
    where: {
      en: "A banner directly under the top navigation bar on every content page (home, watch, movies, series, search, channels).",
      ar: "بانر عرضي تحت القائمة العلوية مباشرة في كل صفحات المحتوى (الرئيسية، المشاهدة، الأفلام، المسلسلات، البحث، القنوات).",
    },
    routePatterns: contentRoutes,
    devices: ["MOBILE", "DESKTOP"],
    ...leaderboard,
  },
  {
    key: "home_top",
    name: { en: "Home – under the hero", ar: "الرئيسية – تحت البانر الكبير" },
    where: {
      en: "Home page, right after the large featured banner.",
      ar: "الصفحة الرئيسية، بعد البانر الكبير المميز مباشرة.",
    },
    routePatterns: ["/"],
    devices: ["MOBILE", "DESKTOP"],
    ...leaderboard,
  },
  {
    key: "home_between_rows",
    name: { en: "Home – between rows", ar: "الرئيسية – بين الصفوف" },
    where: {
      en: "Home page, between the video rows (after the second row).",
      ar: "الصفحة الرئيسية، بين صفوف الفيديوهات (بعد الصف الثاني).",
    },
    routePatterns: ["/"],
    devices: ["MOBILE", "DESKTOP"],
    sizes: [
      [970, 250],
      [728, 90],
      [300, 250],
    ],
    responsive: [
      {
        minWidth: 1024,
        sizes: [
          [970, 250],
          [728, 90],
        ],
      },
      { minWidth: 0, sizes: [[300, 250]] },
    ],
  },
  {
    key: "watch_below_player",
    name: { en: "Watch – under the player", ar: "المشاهدة – تحت البلاير" },
    where: {
      en: "Watch page, directly under the video player.",
      ar: "صفحة مشاهدة الفيديو، تحت البلاير مباشرة.",
    },
    routePatterns: ["/watch/*"],
    devices: ["MOBILE", "DESKTOP"],
    ...rectangle,
  },
  {
    key: "desktop_sidebar",
    name: { en: "Watch – side column", ar: "المشاهدة – العمود الجانبي" },
    where: {
      en: "Watch page, top of the suggested videos column (computer screens).",
      ar: "صفحة المشاهدة، أعلى عمود الفيديوهات المقترحة (شاشات الكمبيوتر).",
    },
    routePatterns: ["/watch/*"],
    devices: ["DESKTOP"],
    sizes: [
      [300, 600],
      [300, 250],
    ],
    responsive: [],
  },
  {
    key: "watch_above_comments",
    name: { en: "Watch – above comments", ar: "المشاهدة – فوق التعليقات" },
    where: {
      en: "Watch page, between the video details and the comments (phones and computers).",
      ar: "صفحة المشاهدة، بين تفاصيل الفيديو والتعليقات (موبايل وكمبيوتر).",
    },
    routePatterns: ["/watch/*"],
    devices: ["MOBILE", "DESKTOP"],
    ...rectangle,
  },
  {
    key: "content_detail",
    name: { en: "Movie / series page", ar: "صفحة الفيلم / المسلسل" },
    where: {
      en: "Movie and series detail pages, under the title and play buttons.",
      ar: "صفحة تفاصيل الفيلم أو المسلسل، تحت العنوان وأزرار التشغيل.",
    },
    routePatterns: ["/movies/*", "/series/*"],
    devices: ["MOBILE", "DESKTOP"],
    ...rectangle,
  },
  {
    key: "search_between_results",
    name: { en: "Search page", ar: "صفحة البحث" },
    where: {
      en: "Search page, between the search box and the results.",
      ar: "صفحة البحث، بين مربع البحث والنتائج.",
    },
    routePatterns: ["/search*"],
    devices: ["MOBILE", "DESKTOP"],
    ...rectangle,
  },
  {
    key: "channel_between_rows",
    name: { en: "Channel page", ar: "صفحة القناة" },
    where: {
      en: "Creator channel page, under the channel header.",
      ar: "صفحة قناة صانع المحتوى، تحت رأس القناة.",
    },
    routePatterns: ["/c/*"],
    devices: ["MOBILE", "DESKTOP"],
    ...rectangle,
  },
  {
    key: "browse_directory",
    name: { en: "Movies / series / creators lists", ar: "قوائم الأفلام والمسلسلات والقنوات" },
    where: {
      en: "Top of the Movies, Series and Creators directory pages.",
      ar: "أعلى صفحات دليل الأفلام والمسلسلات وصناع المحتوى.",
    },
    routePatterns: ["/movies", "/series", "/creators"],
    devices: ["MOBILE", "DESKTOP"],
    ...leaderboard,
  },
  {
    key: "tv_directory",
    name: { en: "TV channels page", ar: "صفحة قنوات التلفزيون" },
    where: {
      en: "The live TV channels directory page.",
      ar: "صفحة دليل قنوات التلفزيون المباشرة.",
    },
    routePatterns: ["/tv"],
    devices: ["MOBILE", "DESKTOP", "TV"],
    ...leaderboard,
  },
  {
    key: "mobile_anchor",
    name: { en: "Mobile sticky bottom banner", ar: "بانر لاصق أسفل شاشة الموبايل" },
    where: {
      en: "A small 320×50 banner fixed above the bottom bar on phones, with a close button. Not shown inside the apps.",
      ar: "بانر صغير 320×50 ثابت فوق شريط التنقل السفلي على الموبايل، وفيه زر إغلاق. مش بيظهر جوه التطبيقات.",
    },
    routePatterns: contentRoutes,
    devices: ["MOBILE"],
    sizes: [
      [320, 50],
      [320, 100],
    ],
    responsive: [],
  },
  {
    key: "footer_above",
    name: { en: "Above the footer", ar: "فوق الفوتر" },
    where: {
      en: "A banner just above the page footer on every content page.",
      ar: "بانر عرضي فوق الفوتر (أسفل الصفحة) في كل صفحات المحتوى.",
    },
    routePatterns: contentRoutes,
    devices: ["MOBILE", "DESKTOP"],
    ...leaderboard,
  },
];

export function pageAdSlotDefinition(key: string) {
  return pageAdSlotCatalog.find((slot) => slot.key === key) ?? null;
}
