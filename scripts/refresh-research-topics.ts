// Queue missing research labels; model calls happen only inside the worker.
// docker compose exec worker node scripts/refresh-research-topics.ts
import { sql, closeDb } from "@aihot/backend/db";
import { PROMPT_VERSIONS } from "@aihot/backend/editorial/analyze";
import { enqueue, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";

try {
  const rows = await sql<{ id: string }[]>`
    SELECT a.id FROM articles a
    JOIN LATERAL (SELECT input_revision, output FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) j
      ON j.input_revision = a.revision
    JOIN publications p ON p.article_id = a.id
    WHERE p.visibility = 'public' AND p.eligible
      AND j.output->>'researchTopicsVersion' IS DISTINCT FROM ${PROMPT_VERSIONS.structure}
      AND NOT EXISTS (SELECT 1 FROM editorial_overrides e WHERE e.article_id = a.id AND e.fields ? 'tags')
    ORDER BY p.selected DESC, a.discovered_at DESC`;
  let queued = 0;
  for (const row of rows) {
    if (await enqueue(QUEUES.researchTopics, { articleId: row.id }, { singletonKey: row.id })) queued++;
  }
  console.log(JSON.stringify({ candidates: rows.length, queued }));
} finally {
  await stopBoss();
  await closeDb();
}
