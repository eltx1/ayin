// Keep the original Browse/Analytics baseline and product-route measurements
// on the same explicit laboratory conditions.
export const performanceLabProfiles = [
  {
    name: "desktop-unthrottled",
    viewport: { width: 1440, height: 1000 },
    cpuRate: 1,
    latencyMs: 0,
    downloadBytesPerSecond: -1,
    uploadBytesPerSecond: -1,
  },
  {
    name: "mobile-constrained",
    viewport: { width: 390, height: 844 },
    cpuRate: 4,
    latencyMs: 150,
    downloadBytesPerSecond: 200_000,
    uploadBytesPerSecond: 96_000,
  },
];
