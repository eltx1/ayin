export function containsBlockedTerm(text: string, terms: string[]) {
  const normalized = text.toLocaleLowerCase();
  return terms.some(
    (term) => term.trim() !== "" && normalized.includes(term.trim().toLocaleLowerCase()),
  );
}
