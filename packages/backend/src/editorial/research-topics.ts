// Refresh only research labels on an existing judgement. Paid work belongs to the worker;
// a new analysis row keeps the prior copy, scores and receipts available for audit.
import { mergeResearchTags } from "@aihot/industry/topics";
import { sql } from "../db.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { publishArticleTx } from "../publication/publish.ts";
import { loadAnalyzeInput, PROMPT_VERSIONS, runStructure } from "./analyze.ts";

export async function refreshResearchTopics(articleId: string) {
  const input = await loadAnalyzeInput(articleId);
  if (!input) return { state: "missing" };
  const [before] = await sql<{ id: number; input_revision: number; version: string | null; manual: boolean }[]>`
    SELECT a.id, a.input_revision, a.output->>'researchTopicsVersion' AS version,
      EXISTS (SELECT 1 FROM editorial_overrides e WHERE e.article_id = a.article_id AND e.fields ? 'tags') AS manual
    FROM analyses a WHERE a.article_id = ${articleId} ORDER BY input_revision DESC, id DESC LIMIT 1`;
  if (!before || before.input_revision !== input.revision) return { state: "needs-analysis" };
  if (before.manual) return { state: "manual-tags" };
  if (before.version === PROMPT_VERSIONS.structure) return { state: "current" };

  const result = await runStructure(input);
  return sql.begin(async (tx) => {
    const [article] = await tx<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${articleId} FOR UPDATE`;
    const [latest] = await tx<{ id: number; tags: string[] }[]>`
      SELECT id, tags FROM analyses WHERE article_id = ${articleId} ORDER BY input_revision DESC, id DESC LIMIT 1`;
    // Paid answers are durable even if the input changed while the request was in flight.
    await completeReceipt(tx, result.receiptId);
    if (!article || article.revision !== input.revision || latest?.id !== before.id) return { state: "stale" };
    const tags = mergeResearchTags(latest.tags, result.tags);
    const detail = { researchTopicsVersion: PROMPT_VERSIONS.structure, researchTopicsModel: result.model, researchTopicsReceiptId: result.receiptId };
    await tx`
      INSERT INTO analyses (article_id, input_revision, origin, model, prompt_version, receipt_ids, relevance, category,
                            tags, subjects, title_zh, summary_zh, reason_zh, score, selected, output)
      SELECT article_id, input_revision, origin, model, prompt_version, array_append(receipt_ids, ${result.receiptId}::bigint), relevance, category,
             ${tags}::text[], subjects, title_zh, summary_zh, reason_zh, score, selected, coalesce(output, '{}'::jsonb) || ${tx.json(detail)}
      FROM analyses WHERE id = ${before.id}`;
    await publishArticleTx(tx, articleId);
    return { state: "updated", tags };
  });
}
