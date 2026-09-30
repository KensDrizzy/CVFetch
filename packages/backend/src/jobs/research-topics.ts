import type { PgBoss } from "pg-boss";
import { refreshResearchTopics } from "../editorial/research-topics.ts";
import { BudgetExceededError, ReceiptBusyError } from "../providers/receipts.ts";
import { enqueue, ensureQueue, QUEUES } from "./queue.ts";

export async function registerResearchTopicJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.researchTopics);
  await boss.work<{ articleId: string }>(QUEUES.researchTopics, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    try {
      return await refreshResearchTopics(job.data.articleId);
    } catch (error) {
      if (error instanceof BudgetExceededError || error instanceof ReceiptBusyError) {
        const seconds = error instanceof BudgetExceededError ? error.retryAfterSeconds : 60;
        await enqueue(QUEUES.researchTopics, job.data, { singletonKey: job.data.articleId, startAfter: Math.max(1, seconds) });
        return { state: "waiting", retryAfterSeconds: seconds };
      }
      throw error;
    }
  });
}
