import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { stopBoss } from "@aihot/backend/jobs/queue";

after(async () => { await stopBoss(); await closeDb(); });

test("numbered selected pages have no overlap, retain scope and agree with cursor paging", async () => {
  const scope = tag();
  const sourceId = `page-${scope}`;
  await sql`INSERT INTO sources (id,name,kind,enabled,config) VALUES (${sourceId},'Page fixture','external',false,'{"contentType":"paper"}')`;
  const now = new Date();
  const at = new Date(now.getTime() - 3600_000);
  for (let i = 0; i < 25; i++) {
    const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${scope}/${i}`, title: `Paper ${i}`, via: "import", discoveredAt: at, publishedAt: at });
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected,score)
      VALUES (${articleId},1,'rule','pass','paper',ARRAY['医学影像'],${`Paper ${i}`},'Abstract',true,90)`;
    await publishArticle(articleId, { releasedAt: at });
    await sql`UPDATE publications SET tags=ARRAY[${scope},'医学影像'], selected=${i !== 23}, visibility=${i === 24 ? 'withdrawn' : 'public'} WHERE article_id=${articleId}`;
  }
  const query = { channel: "all" as const, category: null, tag: scope, contentType: "paper" as const, topic: "medical-imaging", topicTags: ["医学影像"], limit: 20, now };
  const first = await loadTimeline({ ...query, page: 1 });
  const second = await loadTimeline({ ...query, page: 2 });
  assert.deepEqual(first.pagination, { page: 1, pageSize: 20, total: 23, pageCount: 2 });
  assert.equal(first.cards.length, 20);
  assert.equal(second.cards.length, 3);
  assert.equal(new Set([...first.cards, ...second.cards].map((c) => c.key)).size, 23);
  assert.deepEqual((await loadTimeline({ ...query, cursor: first.nextCursor })).cards, second.cards);
  assert.deepEqual((await loadTimeline({ ...query, page: 99 })).pagination, { page: 2, pageSize: 20, total: 23, pageCount: 2 });
  const empty = await loadTimeline({ ...query, topic: "remote-sensing", topicTags: ["遥感视觉"], page: 2 });
  assert.deepEqual(empty.pagination, { page: 1, pageSize: 20, total: 0, pageCount: 1 });
  assert.equal(empty.cards.length, 0);
  assert.equal((await loadTimeline({ ...query, contentType: "post", page: 1 })).pagination?.total, 0);
});
