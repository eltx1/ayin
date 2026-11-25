const cacheBusterMacro =
  /(?:\[|%5B)(?:timestamp|cachebuster|cache_buster|random)(?:\]|%5D)|%%CACHEBUSTER%%/giu;

/**
 * Fills cache-buster macros for one ad request. Run for every break so repeated mid-rolls send
 * distinct URLs; handles both raw "[timestamp]" and URL-encoded "%5Btimestamp%5D" forms.
 */
export function fillVastRequestMacros(tagUrl: string, now = Date.now(), random = Math.random()) {
  const value = `${now}${Math.floor(random * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  return tagUrl.replace(cacheBusterMacro, value);
}
