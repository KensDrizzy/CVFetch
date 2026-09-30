// Reader-facing source status: no raw configuration, error bodies, or credentials leave this layer.
import { credential } from "../config.ts";
import { sql } from "../db.ts";
import { ACADEMIC_ADAPTERS } from "../sources/academic.ts";

export async function listPublicSources() {
  const rows = await sql<{ id: string; name: string; kind: string; config: Record<string, any>; enabled: boolean; health: string; last_ok_at: Date | null; last_error: string | null }[]>`
    SELECT id,name,kind,config,enabled,health,last_ok_at,last_error FROM sources
    WHERE participation_mode = 'editorial' ORDER BY first_party DESC, name`;
  return rows.map((s) => {
    const missing: string[] = [];
    if (s.kind === "x_search" && !credential("collectors", "SOCIALDATA_API_KEY")) missing.push("X 采集服务");
    if (s.kind === "mp_account") {
      if (!credential("collectors", "DAJIALA_KEY")) missing.push("公众号采集服务");
      if (!s.config.ghid && !s.config.wxid) missing.push("公众号账号标识");
    }
    const post = s.kind === "x_search" || s.kind === "mp_account" || s.config.contentType === "post";
    const profile = typeof s.config.profileUrl === "string" && /^https:\/\//.test(s.config.profileUrl) ? s.config.profileUrl : null;
    return { id: s.id, name: s.name, contentType: post ? "post" : "paper", platform: s.config.platform ?? (post ? s.kind : "论文库"), url: profile,
      state: missing.length ? "pending" : !s.enabled ? "paused" : s.last_error ? "retrying" : s.last_ok_at ? "active" : "starting",
      requirements: missing, lastSuccessAt: s.last_ok_at?.toISOString() ?? null,
      note: s.config.adapter === "cvf" ? "会议论文按批次归档，不计为今日新发布。" : ACADEMIC_ADAPTERS.includes(s.config.adapter) ? "按标题与摘要检索近期论文，索引可能有延迟。" : null };
  });
}
