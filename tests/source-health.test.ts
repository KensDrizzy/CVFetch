import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { sql, closeDb } from '@aihot/backend/db';
import { config } from '@aihot/backend/config';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { collectSource, adaptIntervals } from '@aihot/backend/sources/collect';
import { retryAfterMs } from '@aihot/backend/sources/types';
import { listPublicSources, sourceIssue } from '@aihot/backend/publication/sources';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
const T = tag();
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null;
after(async () => { await mock.close(); await stopBoss(); await closeDb(); });

test('rate limits respect Retry-After without advancing cursors or accelerating scholarly feeds', async () => {
  const now = Date.parse('2026-10-04T00:00:00Z');
  assert.equal(retryAfterMs('120', now), 120_000);
  assert.equal(retryAfterMs('Sun, 04 Oct 2026 01:00:00 GMT', now), 3600_000);
  for (const value of [null, '', '-1', 'not-a-date']) assert.equal(retryAfterMs(value, now), null);
  assert.equal(retryAfterMs('99999999', now), 86400_000);
  const id = `retry-${T}`;
  await sql`INSERT INTO sources (id,name,kind,config,interval_minutes,cursor) VALUES (${id},'Retry fixture','rss',${sql.json({feedUrl:'https://collector.example/feed'})},60,'{"marker":1}')`;
  mock.get('https://collector.example').intercept({path:'/feed'}).reply(429, '', {headers:{'retry-after':'57600'}});
  assert.equal((await collectSource(id)).status, 'failed');
  const [row] = await sql`SELECT cursor,fail_count,extract(epoch FROM next_fetch_at-now())::float AS seconds FROM sources WHERE id=${id}`;
  assert.deepEqual(row!.cursor, {marker:1}); assert.equal(row!.fail_count, 1);
  assert.ok(row!.seconds > 57590 && row!.seconds <= 57600);
  await sql`UPDATE sources SET config='{"feedUrl":"https://export.arxiv.org/api/query"}',interval_minutes=240 WHERE id=${id}`;
  await adaptIntervals();
  assert.equal((await sql`SELECT interval_minutes FROM sources WHERE id=${id}`)[0]!.interval_minutes, 240);
});

test('public source health distinguishes delayed checks and excludes private counts and raw errors', async () => {
  const id = `health-${T}`;
  const now = new Date();
  const old = new Date(now.getTime()-7200_000);
  await sql`INSERT INTO sources (id,name,kind,enabled,config,last_ok_at,last_fetch_at,next_fetch_at,cursor)
    VALUES (${id},'Health fixture','json_list',true,'{"adapter":"cvf"}',${old},${old},${old},'{"academic":{"offset":10,"total":100}}')`;
  for (let i=0;i<3;i++) {
    const {articleId} = await upsertMaterial({sourceId:id,url:`https://example.com/${id}/${i}`,title:'Paper',via:'import'});
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected,score) VALUES (${articleId},1,'rule','pass','paper',ARRAY['医学影像'],'Paper','Abstract',true,90)`;
    await publishArticle(articleId,{releasedAt:old});
    if(i===1) await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${articleId}`;
    if(i===2) await sql`UPDATE publications SET visible_after=${new Date(now.getTime()+3600_000)} WHERE article_id=${articleId}`;
  }
  const status = (await listPublicSources(now)).find((s)=>s.id===id)!;
  assert.equal(status.state,'delayed'); assert.equal(status.publicCount,1);
  assert.deepEqual(status.archive,{processed:10,total:100});
  await sql`UPDATE sources SET last_error='HTTP 429 token=secret-fixture',next_fetch_at=${new Date(now.getTime()+3600_000)} WHERE id=${id}`;
  const retry = (await listPublicSources(now)).find((s)=>s.id===id)!;
  assert.equal(retry.state,'retrying'); assert.match(retry.issue!,/限流/);
  assert.ok(!JSON.stringify(retry).includes('secret-fixture')); assert.ok(!('config' in retry));
  assert.match(sourceIssue('fetch failed https://private.example/token')!, /网络/);
});

test('metered scholarly requests keep their receipt and upstream retry delay', async () => {
  const id = `oa-retry-${T}`;
  await sql`INSERT INTO sources (id,name,kind,config,interval_minutes) VALUES (${id},'OpenAlex retry fixture','json_list','{"adapter":"openalex"}',360)`;
  mock.get('https://api.openalex.org').intercept({path:/^\/works\?/}).reply(503,'',{headers:{'retry-after':'43200'}});
  assert.equal((await collectSource(id)).status,'failed');
  const [row] = await sql`SELECT extract(epoch FROM next_fetch_at-now())::float AS seconds FROM sources WHERE id=${id}`;
  assert.ok(row!.seconds > 43190 && row!.seconds <= 43200);
  const [receipt] = await sql`SELECT status FROM receipts WHERE service='openalex' AND subject=${id}`;
  assert.equal(receipt!.status,'failed');
});
