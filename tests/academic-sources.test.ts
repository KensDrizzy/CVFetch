import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { MockAgent, setGlobalDispatcher } from "undici";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { normalizePaperIdentifier } from "@aihot/backend/content/paper-identity";
import { semanticPaper, openalexPaper, cvfPaper, fetchAcademic } from "@aihot/backend/sources/academic";
import { collectSource } from "@aihot/backend/sources/collect";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadPool } from "@aihot/backend/publication/pool";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { listPublicSources } from "@aihot/backend/publication/sources";
import type { SourceRow } from "@aihot/backend/sources/types";
const T = tag();
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null;
after(async () => { await stopBoss(); await closeDb(); await mock.close(); });
const s2 = { paperId: "a".repeat(40), title: "Medical image segmentation", abstract: "Segmenting tissue with vision.", publicationDate: "2026-09-01", authors: [{ name: "Author One" }, { name: "Author Two" }], externalIds: { ArXiv: "2609.12345v2", DOI: "10.1234/PAPER" } };
const detail = `<meta name="citation_title" content="3D reconstruction"><meta name="citation_author" content="Researcher"><meta name="citation_doi" content="10.1234/cvf"><div id="abstract">A geometry based reconstruction method.</div><a href="https://arxiv.org/abs/2609.54321">arXiv</a>`;
async function source(id: string, cfg: Record<string, unknown>, kind = "json_list") {
  await sql`INSERT INTO sources (id,name,kind,config,tier,participation_mode,next_fetch_at) VALUES (${id},${id},${kind},${sql.json(cfg as never)},'T1','editorial','2100-01-01')`;
  return (await sql<SourceRow[]>`SELECT * FROM sources WHERE id=${id}`)[0]!;
}

test("scholarly records preserve authors and abstracts, normalize IDs, and tolerate missing abstracts", () => {
  const paper = semanticPaper(s2)!;
  assert.equal(paper.author, "Author One, Author Two");
  assert.deepEqual(paper.paperIdentifiers, [`s2:${s2.paperId}`, "arxiv:2609.12345", "doi:10.1234/paper"]);
  assert.equal(semanticPaper({ ...s2, abstract: null })!.bodyStatus, "none");
  const oa = openalexPaper({ id: "https://openalex.org/W123", title: "Geometry", doi: "https://doi.org/10.1234/PAPER", abstract_inverted_index: { vision: [1], Computer: [0, 2] }, authorships: [{ author: { display_name: "Author" } }], locations: [{ pdf_url: "https://arxiv.org/pdf/2609.12345v1.pdf" }] })!;
  assert.equal(oa.bodyText, "Computer vision Computer");
  assert.equal(oa.url, "https://arxiv.org/abs/2609.12345");
  assert.ok(cvfPaper(detail, "https://openaccess.thecvf.com/content/CVPR2026/html/test.html", "2026-05-23").paperIdentifiers?.includes("doi:10.1234/cvf"));
  assert.throws(() => cvfPaper("<h1>Login</h1>", "https://example.com", null));
  assert.equal(normalizePaperIdentifier("https://x.com/author/status/123?paper=arxiv:2609.12345"), null);
});

test("arXiv versions and scholarly providers become discoveries of one paper, not overwritten copies", async () => {
  const sources = await Promise.all(["arxiv", "s2", "oa"].map((name) => source(`${T}-${name}`, {})));
  const base = { url: "https://arxiv.org/abs/2609.12345v1", title: `Original ${T}`, bodyText: "Original abstract", via: "fetch" as const };
  const original = await upsertMaterial({ ...base, sourceId: sources[0]!.id });
  const [second, third] = await Promise.all([
    upsertMaterial({ ...base, ...semanticPaper(s2)!, sourceId: sources[1]!.id, via: "fetch" }),
    upsertMaterial({ ...base, sourceId: sources[2]!.id, url: "https://doi.org/10.1234/paper", paperIdentifiers: ["arxiv:2609.12345", "doi:10.1234/paper"], title: "Other rendering" }),
  ]);
  assert.equal(second.articleId, original.articleId); assert.equal(third.articleId, original.articleId);
  assert.equal(second.revised, false); assert.equal(third.created, false);
  assert.equal((await sql`SELECT title FROM articles WHERE id=${original.articleId}`)[0]!.title, base.title);
  assert.equal((await sql`SELECT count(*)::int AS n FROM article_discoveries WHERE article_id=${original.articleId}`)[0]!.n, 3);
});

test("CVF advances bounded conference batches only after successful storage", async () => {
  const id = `cvf-${T}`;
  const src = await source(id, { adapter: "cvf", conference: "CVPR", batchSize: 1, _aihot: { initialBackfillLimit: 1, initialBackfillMonths: 24 } });
  const host = mock.get("https://openaccess.thecvf.com");
  host.intercept({ path: "/" }).reply(302, "", { headers: { location: "/menu" } }).persist();
  host.intercept({ path: "/menu" }).reply(200, '<dd><a href="/CVPR2026">Main Conference</a><span>(Published: May 23, 2026)</span></dd>').persist();
  host.intercept({ path: "/CVPR2026?day=all" }).reply(200, '<dt class="ptitle"><a href="/content/CVPR2026/html/a.html">A paper</a></dt><dt class="ptitle"><a href="/content/CVPR2026/html/b.html">B paper</a></dt>').persist();
  host.intercept({ path: "/content/CVPR2026/html/a.html" }).reply(200, detail);
  assert.equal((await collectSource(id)).created, 1);
  assert.equal((await sql`SELECT cursor FROM sources WHERE id=${id}`)[0]!.cursor.academic.offset, 1);
  host.intercept({ path: "/content/CVPR2026/html/b.html" }).reply(503, "temporary failure");
  assert.equal((await collectSource(id)).status, "failed");
  assert.equal((await sql`SELECT cursor FROM sources WHERE id=${id}`)[0]!.cursor.academic.offset, 1);
  host.intercept({ path: "/content/CVPR2026/html/b.html" }).reply(200, detail.replaceAll("10.1234/cvf", "10.1234/cvf-b").replaceAll("2609.54321", "2609.54322"));
  assert.equal((await collectSource(id)).created, 1);
  assert.equal((await sql`SELECT cursor FROM sources WHERE id=${id}`)[0]!.cursor.academic.offset, 2);
  assert.equal((await fetchAcademic({ ...src, cursor: { academic: { conference: "https://openaccess.thecvf.com/CVPR2026", offset: 2 } } })).candidates.length, 0);
});

test("paper and author streams stay separate even when a post has the paper category", async () => {
  const paperSource = await source(`stream-paper-${T}`, { contentType: "paper" });
  const postSource = await source(`stream-post-${T}`, { contentType: "post", platform: "小红书" }, "external");
  const all: string[] = [];
  for (const src of [paperSource, postSource]) {
    const { articleId } = await upsertMaterial({ sourceId: src.id, url: `https://example.com/${src.id}`, title: "CV research", via: "fetch" });
    all.push(articleId);
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected,score) VALUES (${articleId},1,'rule','pass','paper',ARRAY['医学影像'],${src.name},'CV abstract',true,90)`;
    await publishArticle(articleId, { releasedAt: new Date(Date.now()-60_000) });
  }
  const filter = { channel: "all" as const, category: null, tag: null, topic: "medical-imaging", topicTags: ["医学影像"], now: new Date() };
  for (const [i, contentType] of (["paper", "post"] as const).entries()) {
    const pool = await loadPool({ ...filter, contentType });
    assert.ok(pool.items.some((p) => p.id === all[i])); assert.ok(!pool.items.some((p) => p.id === all[1-i]));
    const timeline = await loadTimeline({ ...filter, contentType });
    assert.ok(timeline.cards.some((c) => c.item.id === all[i])); assert.ok(!timeline.cards.some((c) => c.item.id === all[1-i]));
  }
  const pending = await source(`pending-${T}`, { nickname: "Test", contentType: "post" }, "mp_account");
  await sql`UPDATE sources SET enabled=false WHERE id=${pending.id}`;
  const status = (await listPublicSources()).find((s) => s.id === pending.id)!;
  assert.equal(status.state, "pending"); assert.ok(status.requirements.includes("公众号账号标识"));
  assert.ok(!("config" in status));
});


test("official APIs constrain dates and CV scope; missing metadata never triggers full-text fetching", async () => {
  const src = await source(`s2-fetch-${T}`, { adapter: "semantic_scholar" });
  mock.get("https://api.semanticscholar.org").intercept({ path: (path: string) => {
    const url = new URL(path, "https://api.semanticscholar.org");
    assert.equal(url.pathname, "/graph/v1/paper/search/bulk");
    assert.ok(url.searchParams.get("publicationDateOrYear")?.endsWith(new Date().toISOString().slice(0, 10)));
    return true;
  } }).reply(200, { data: [{ ...s2, abstract: null }] });
  assert.equal((await fetchAcademic(src)).candidates[0]!.bodyStatus, "none");
  mock.get("https://api.openalex.org").intercept({ path: (path: string) => {
    const url = new URL(path, "https://api.openalex.org");
    assert.ok(url.searchParams.get("filter")?.includes("topics.subfield.id:1707"));
    assert.ok(url.searchParams.get("filter")?.includes("to_publication_date:"));
    assert.equal(url.searchParams.has("api_key"), false);
    return true;
  } }).reply(200, { results: [{ id: "https://openalex.org/W1234", title: "Image research" }] });
  const oa = await source(`oa-fetch-${T}`, { adapter: "openalex" });
  assert.equal((await fetchAcademic(oa)).candidates.length, 1);
  assert.equal((await fetchAcademic(oa)).candidates.length, 1, "the same collection window reuses its receipt");
});
