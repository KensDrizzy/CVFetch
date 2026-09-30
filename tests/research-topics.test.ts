import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { normalizeAnalysis } from "@aihot/backend/editorial/analyze";
import { refreshResearchTopics } from "@aihot/backend/editorial/research-topics";
import { publishArticle } from "@aihot/backend/publication/publish";
import { seedTopics, listTopicSummaries, loadTopicPage } from "@aihot/backend/publication/topics";
import { loadPool } from "@aihot/backend/publication/pool";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
let duringRequest: (() => Promise<void>) | null = null;
const provider = await stub(async (_hit, req) => {
  assert.match(JSON.parse(req.body).messages[0].content, /医学影像/);
  if (duringRequest) await duringRequest();
  return { choices: [{ message: { content: JSON.stringify({ category: "paper", tags: ["论文", "医学影像", "检测与分割"], subjects: [], fact: null }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});
Object.assign(process.env, { STRUCTURE_MODEL: "default", LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "test-topic-model", MODEL_CALLS_ENABLED: "true" });
after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

async function paper(suffix: string) {
  const sourceId = `research-${T}-${suffix}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${sourceId}, 'Research test', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${sourceId}`, title: `Medical segmentation ${suffix}`, bodyText: "A new segmentation method for medical imaging. ".repeat(10), bodyStatus: "ok", via: "fetch", publishedAt: new Date() } as never);
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'paper', ARRAY['论文','研究'], '原来的标题', '原来的摘要', '原来的理由', 90, true)`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  return articleId;
}

test("structural research labels survive writer tags and allow overlapping directions", () => {
  const out = normalizeAnalysis({ prefilter: { label: "PASS", reason: "", model: "test", receiptId: 1, reused: false }, scores: null,
    writing: { kind: "understand", model: "test", titleZh: "标题", summaryZh: "摘要", reasonZh: null, tags: ["论文", "研究"], receiptIds: [], reused: false },
    structure: { model: "test", category: "paper", tags: ["论文", "医学影像", "检测与分割"], subjects: [], fact: null, receiptId: 2, reused: false } });
  assert.deepEqual(out.tags, ["论文", "医学影像", "检测与分割", "研究"]);
});

test("backfill preserves editorial judgement, publishes both themes, and is idempotent", async () => {
  const id = await paper("preserve");
  const hits = provider.hits();
  assert.equal((await refreshResearchTopics(id)).state, "updated");
  assert.equal((await refreshResearchTopics(id)).state, "current");
  assert.equal(provider.hits(), hits + 1);
  const [row] = await sql`SELECT title_zh, summary_zh, reason_zh, score, selected, category, tags FROM analyses WHERE article_id = ${id} ORDER BY id DESC LIMIT 1`;
  assert.deepEqual(row, { title_zh: "原来的标题", summary_zh: "原来的摘要", reason_zh: "原来的理由", score: 90, selected: true, category: "paper", tags: ["论文", "医学影像", "检测与分割", "研究"] });
  await seedTopics();
  assert.equal((await listTopicSummaries()).length, 9);
  for (const topic of ["medical-imaging", "detection-segmentation"]) {
    assert.ok((await loadTopicPage(topic, 1))?.items.some((item) => item.id === id));
  }
  assert.ok(!(await loadTopicPage("remote-sensing", 1))?.items.some((item) => item.id === id));
  const filter = { channel: "all" as const, category: null, tag: null, topic: "medical-imaging", topicTags: ["医学影像"], now: new Date() };
  assert.ok((await loadPool(filter)).items.some((item) => item.id === id));
  assert.match(JSON.stringify((await loadTimeline(filter)).cards), new RegExp(id));
  assert.ok(!(await loadPool({ ...filter, topic: "remote-sensing", topicTags: ["遥感视觉"] })).items.some((item) => item.id === id));
});

test("a changed input cannot receive stale classification", async () => {
  const id = await paper("stale");
  duringRequest = async () => { await sql`UPDATE articles SET revision = revision + 1 WHERE id = ${id}`; };
  try { assert.equal((await refreshResearchTopics(id)).state, "stale"); }
  finally { duringRequest = null; }
  const [row] = await sql`SELECT count(*)::int AS count FROM analyses WHERE article_id = ${id}`;
  assert.equal(row!.count, 1);
});


test("manual research labels are preserved without a paid request", async () => {
  const id = await paper("manual");
  await sql`INSERT INTO editorial_overrides (article_id, fields) VALUES (${id}, ${sql.json({ tags: ["论文", "遥感视觉"] })})`;
  const hits = provider.hits();
  assert.equal((await refreshResearchTopics(id)).state, "manual-tags");
  assert.equal(provider.hits(), hits);
});
