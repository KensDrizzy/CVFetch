// Reader-facing status: no raw configuration, errors or credentials leave this layer.
import type { PublicSource } from "@aihot/contracts/site";
import { credential } from "../config.ts";
import { sql } from "../db.ts";
import { ACADEMIC_ADAPTERS } from "../sources/academic.ts";

export function sourceIssue(error: string | null): string | null {
  if (!error) return null;
  if (/\b429\b/.test(error)) return "来源限流，已延后重试。";
  if (/\b(401|403)\b/.test(error)) return "来源暂不允许访问，需要检查授权或配额。";
  if (/budget/i.test(error)) return "采集预算暂时用尽，等待额度恢复。";
  if (/timeout|timed out|fetch failed|\b5\d\d\b/i.test(error)) return "网络或来源服务暂时不可用，将自动重试。";
  return "最近一次采集未完成，将自动重试。";
}

export async function listPublicSources(now = new Date()): Promise<PublicSource[]> {
  const rows = await sql<{ id: string; name: string; kind: string; config: Record<string, any>; enabled: boolean; last_ok_at: Date | null; last_fetch_at: Date | null; next_fetch_at: Date | null; last_error: string | null; interval_minutes: number; cursor: Record<string, any> | null; public_count: number }[]>`
    SELECT s.id,s.name,s.kind,s.config,s.enabled,s.last_ok_at,s.last_fetch_at,s.next_fetch_at,s.last_error,s.interval_minutes,s.cursor,
      coalesce(c.public_count,0)::int AS public_count
    FROM sources s LEFT JOIN (
      SELECT d.source_id,count(DISTINCT d.article_id) AS public_count FROM article_discoveries d JOIN publications p ON p.article_id=d.article_id
      WHERE p.visibility='public' AND p.eligible AND (NOT p.selected OR p.visible_after <= ${now}) GROUP BY d.source_id
    ) c ON c.source_id=s.id WHERE participation_mode='editorial' ORDER BY first_party DESC, name`;
  return rows.map((s) => {
    const missing: string[] = [];
    if (s.kind === "x_search" && !credential("collectors", "SOCIALDATA_API_KEY")) missing.push("X 采集服务");
    if (s.kind === "mp_account") {
      if (!credential("collectors", "DAJIALA_KEY")) missing.push("公众号采集服务");
      if (!s.config.ghid && !s.config.wxid) missing.push("公众号账号标识");
    }
    const post = s.kind === "x_search" || s.kind === "mp_account" || s.config.contentType === "post";
    const arxiv = /^https:\/\/(?:export\.)?arxiv\.org\//i.test(String(s.config.feedUrl ?? ""));
    const profile = typeof s.config.profileUrl === "string" && /^https:\/\//.test(s.config.profileUrl) ? s.config.profileUrl : arxiv ? "https://arxiv.org/list/cs.CV/recent" : null;
    const delayed = !!s.next_fetch_at && now.getTime() - s.next_fetch_at.getTime() > 30 * 60_000 && (!s.last_fetch_at || now.getTime() - s.last_fetch_at.getTime() > 30 * 60_000);
    const progress = s.cursor?.academic;
    const archive = s.config.adapter === "cvf" && Number.isSafeInteger(progress?.offset) && Number.isSafeInteger(progress?.total) && progress.total > 0 && progress.offset >= 0
      ? { processed: Math.min(progress.offset, progress.total), total: progress.total } : null;
    return { id: s.id, name: s.name, contentType: post ? "post" : "paper", platform: s.config.platform ?? (arxiv ? "arXiv" : post ? s.kind : "论文库"), url: profile,
      state: missing.length ? "pending" : !s.enabled ? "paused" : delayed ? "delayed" : s.last_error ? "retrying" : s.last_ok_at ? "active" : "starting",
      requirements: missing, lastSuccessAt: s.last_ok_at?.toISOString() ?? null,
      intervalMinutes: s.interval_minutes, nextCheckAt: s.enabled && !missing.length ? s.next_fetch_at?.toISOString() ?? null : null,
      lastCheckAt: s.last_fetch_at?.toISOString() ?? null, publicCount: s.public_count, archive,
      issue: sourceIssue(s.last_error),
      note: s.config.adapter === "cvf" ? "逐批补充会议论文，保留原始发布日期。" : ACADEMIC_ADAPTERS.includes(s.config.adapter) ? "检索近期论文；索引收录可能晚于论文发表。" : arxiv ? "跟踪 cs.CV 预印本，以标题与摘要生成导读。" : null };
  });
}
