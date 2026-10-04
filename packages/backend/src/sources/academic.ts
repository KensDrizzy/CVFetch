// Metadata only: official scholarly APIs and CVF abstracts, never paper PDFs.
import * as cheerio from "cheerio";
import { credential } from "../config.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { collapseWhitespace } from "../lib/text.ts";
import { paidRequest, ProviderRejectedError } from "../providers/receipts.ts";
import { normalizePaperIdentifier } from "../content/paper-identity.ts";
import { FetchError, retryAfterMs, type Candidate, type SourceRow } from "./types.ts";

export const ACADEMIC_ADAPTERS = ["semantic_scholar", "openalex", "cvf"];
const text = (v: unknown) => typeof v === "string" ? collapseWhitespace(v) : "";
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v) : null;
const ids = (values: unknown[]) => values.filter((v): v is string => typeof v === "string").map(normalizePaperIdentifier).filter((v): v is string => !!v);

function candidate(p: { title: string; url: string; abstract: string; author: string; published: unknown; identifiers: string[]; metadata: Record<string, unknown> }): Candidate {
  return { title: p.title, url: p.url, author: p.author || null, publishedAt: date(p.published),
    excerpt: p.abstract.slice(0, 2000) || null, bodyText: p.abstract || null, bodyStatus: p.abstract ? "ok" : "none",
    paperIdentifiers: p.identifiers, raw: { paper: p.metadata } };
}

export function semanticPaper(p: any): Candidate | null {
  if (!text(p.title) || !/^[a-f0-9]{40}$/i.test(p.paperId ?? "")) return null;
  const identifiers = ids([`s2:${p.paperId}`, p.externalIds?.ArXiv && `arxiv:${p.externalIds.ArXiv}`, p.externalIds?.DOI && `doi:${p.externalIds.DOI}`]);
  const arxiv = identifiers.find((id) => id.startsWith("arxiv:"));
  const doi = identifiers.find((id) => id.startsWith("doi:"));
  return candidate({ title: text(p.title), url: arxiv ? `https://arxiv.org/abs/${arxiv.slice(6)}` : doi ? `https://doi.org/${doi.slice(4)}` : `https://www.semanticscholar.org/paper/${p.paperId}`,
    abstract: text(p.abstract), author: (p.authors ?? []).map((a: any) => text(a.name)).filter(Boolean).join(", "), published: p.publicationDate,
    identifiers, metadata: { provider: "semantic_scholar", providerId: p.paperId, doi: p.externalIds?.DOI ?? null, arxiv: p.externalIds?.ArXiv ?? null, venue: p.venue ?? null } });
}

export function openalexPaper(p: any): Candidate | null {
  if (!text(p.title) || !/^https:\/\/openalex.org\/W\d+$/i.test(p.id ?? "")) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(p.abstract_inverted_index ?? {})) {
    if (!Array.isArray(positions)) continue;
    for (const index of positions) if (Number.isInteger(index) && index >= 0 && index < 20_000) words[index] = word;
  }
  const identifiers = ids([`openalex:${p.id.split("/").at(-1)}`, p.doi, ...(p.locations ?? []).flatMap((l: any) => [l.landing_page_url, l.pdf_url])]);
  const arxiv = identifiers.find((id) => id.startsWith("arxiv:"));
  const doi = identifiers.find((id) => id.startsWith("doi:"));
  return candidate({ title: text(p.title), url: arxiv ? `https://arxiv.org/abs/${arxiv.slice(6)}` : doi ? `https://doi.org/${doi.slice(4)}` : p.id,
    abstract: words.join(" ").trim(), author: (p.authorships ?? []).map((a: any) => text(a.author?.display_name)).filter(Boolean).join(", "), published: p.publication_date,
    identifiers, metadata: { provider: "openalex", providerId: p.id, doi: p.doi ?? null, venue: p.primary_location?.source?.display_name ?? null } });
}

export function cvfPaper(html: string, url: string, published: string | null): Candidate {
  const $ = cheerio.load(html);
  const meta = (key: string) => $(`meta[name="${key}"]`).attr("content");
  const title = text(meta("citation_title") ?? $("#papertitle").text());
  const abstract = text($("#abstract").text());
  if (!title || !abstract) throw new FetchError("CVF paper title or abstract missing");
  const doi = meta("citation_doi") ?? /doi\s*=\s*[{\"]([^}\"]+)/i.exec($(".bibref").text())?.[1];
  const identifiers = ids([doi, ...$("a[href]").toArray().map((a) => $(a).attr("href"))]);
  return candidate({ title, url, abstract, published, identifiers,
    author: $("meta[name='citation_author']").toArray().map((a) => text($(a).attr("content"))).join(", ") || text($("#authors").text()),
    metadata: { provider: "cvf", providerId: url, doi: doi ?? null, venue: meta("citation_conference_title") ?? null } });
}

async function getText(url: string, headers: Record<string, string> = {}) {
  const res = await guardedFetch(url, { headers, timeoutMs: 35_000, maxBytes: 12 * 1024 * 1024,
    maxRedirects: new URL(url).hostname === "openaccess.thecvf.com" ? 3 : 0 });
  if (res.status !== 200) throw new FetchError(`Academic source HTTP ${res.status}`, res.status, [429, 503].includes(res.status) ? retryAfterMs(res.headers.get("retry-after")) : null);
  return res.text();
}

export async function fetchAcademic(source: SourceRow): Promise<{ candidates: Candidate[]; cursor?: Record<string, unknown> }> {
  const adapter = source.config.adapter;
  if (adapter === "cvf") return fetchCvf(source);
  const days = Math.max(1, Math.min(365, Number(source.config.lookbackDays) || 90));
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  if (adapter === "semantic_scholar") {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search/bulk");
    url.search = new URLSearchParams({ query: String(source.config.query || '"computer vision"'), fields: "title,abstract,authors,externalIds,publicationDate,venue", sort: "publicationDate:desc", publicationDateOrYear: `${since}:${until}` }).toString();
    const key = credential("collectors", "SEMANTIC_SCHOLAR_API_KEY");
    const body = JSON.parse(await getText(url.toString(), key ? { "x-api-key": key } : {}));
    if (!Array.isArray(body.data)) throw new FetchError("Semantic Scholar data missing");
    return { candidates: body.data.slice(0, 50).map(semanticPaper).filter((p: Candidate | null): p is Candidate => !!p) };
  }
  if (adapter === "openalex") {
    const url = new URL("https://api.openalex.org/works");
    url.search = new URLSearchParams({ filter: `topics.subfield.id:1707,from_publication_date:${since},to_publication_date:${until},is_retracted:false`, sort: "publication_date:desc", per_page: "50", select: "id,title,doi,publication_date,abstract_inverted_index,authorships,locations,primary_location" }).toString();
    if (source.config.query) url.searchParams.set("search", String(source.config.query));
    const key = credential("collectors", "OPENALEX_API_KEY");
    // A keyed account can be metered: all requests (including keyless ones) use receipts and budgets.
    const receipt = await paidRequest({ service: "openalex", purpose: "paper_search", subject: source.id,
      identity: { url: url.toString(), window: Math.floor(Date.now() / (source.interval_minutes * 60_000)) }, requestSummary: { source: source.id, query: source.config.query ?? "computer vision" } }, async () => {
      const res = await guardedFetch(url.toString(), { headers: key ? { authorization: `Bearer ${key}` } : {}, timeoutMs: 35_000, maxRedirects: 0 });
      if (res.status !== 200) throw new ProviderRejectedError(`OpenAlex HTTP ${res.status}`, res.status, res.status === 429 || res.status >= 500, [429, 503].includes(res.status) ? retryAfterMs(res.headers.get("retry-after")) : null);
      const body = JSON.parse(res.text());
      if (!Array.isArray(body.results)) throw new Error("OpenAlex results missing");
      return { response: body, usage: { requests: 1 }, cost: null };
    });
    const body = receipt.response as { results: any[] };
    return { candidates: body.results.map(openalexPaper).filter((p): p is Candidate => !!p) };
  }
  throw new FetchError("unknown academic adapter");
}

async function fetchCvf(source: SourceRow) {
  const conference = String(source.config.conference ?? "CVPR");
  if (!["CVPR", "ICCV", "WACV"].includes(conference)) throw new FetchError("unknown CVF conference");
  const home = cheerio.load(await getText("https://openaccess.thecvf.com/"));
  const entries = home("a[href]").toArray().map((a) => {
    const url = new URL(home(a).attr("href")!, "https://openaccess.thecvf.com/");
    const match = new RegExp(`^/${conference}(\\d{4})/?$`).exec(url.pathname);
    if (url.origin !== "https://openaccess.thecvf.com" || !match) return null;
    const line = home(a).parent().text();
    const published = /Published:\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(line)?.[1] ?? null;
    return { url: url.toString(), year: Number(match[1]), published: date(published)?.toISOString() ?? null };
  }).filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => b.year - a.year);
  const entry = entries[0];
  if (!entry) throw new FetchError("CVF conference index missing");
  const listing = new URL(entry.url); listing.searchParams.set("day", "all");
  const $ = cheerio.load(await getText(listing.toString()));
  const urls = [...new Set($("dt.ptitle a[href]").toArray().map((a) => new URL($(a).attr("href")!, listing).toString()))]
    .filter((url) => new URL(url).origin === listing.origin && /\/html\/.*\.html$/.test(url));
  if (!urls.length) throw new FetchError("CVF paper listing missing");
  const prior = source.cursor?.academic;
  const offset = prior?.conference === entry.url ? Math.max(0, Number(prior.offset) || 0) : 0;
  const initialLimit = source.cursor?.initializedAt ? 10 : Math.max(1, Number(source.config._aihot?.initialBackfillLimit) || 5);
  const batch = Math.min(10, initialLimit, Math.max(1, Number(source.config.batchSize) || 5));
  const selected = urls.slice(offset, offset + batch);
  const candidates: Candidate[] = [];
  for (const url of selected) candidates.push(cvfPaper(await getText(url), url, entry.published));
  return { candidates, cursor: { conference: entry.url, offset: offset + selected.length, total: urls.length } };
}
