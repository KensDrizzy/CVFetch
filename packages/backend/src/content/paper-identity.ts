/** Stable paper IDs; a paper and a social post linking to it remain distinct materials. */
export function normalizePaperIdentifier(value: string): string | null {
  const raw = value.trim();
  const arxiv = /^(?:arxiv:|https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\/)(.+)$/i.exec(raw)?.[1]?.replace(/[?#].*$/, "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  if (arxiv && /^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})$/i.test(arxiv)) return `arxiv:${arxiv.toLowerCase()}`;
  const doi = raw.replace(/^(?:doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i, "");
  if (/^10\.\d{4,9}\/\S+$/i.test(doi)) return `doi:${doi.toLowerCase()}`;
  if (/^(s2:[a-f0-9]{40}|openalex:W\d+)$/i.test(raw)) return raw.toLowerCase();
  return null;
}
