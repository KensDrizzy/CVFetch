import { Link, useLoaderData } from "react-router";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

export interface PublicSource {
  id: string; name: string; contentType: string; platform: string; url: string | null;
  state: string; requirements: string[]; lastSuccessAt: string | null; note: string | null;
}
export async function loader({ request }: { request: Request }) {
  return apiGet<{ sources: PublicSource[] }>("/api/site/sources", { signal: request.signal });
}
export function meta() { return pageMeta({ title: "关注来源", description: "CVFetch 的论文库、研究作者与采集状态。", path: "/following" }); }
export function headers() { return { "Cache-Control": "public, max-age=0, s-maxage=30" }; }
const states: Record<string, string> = { pending: "待配置", paused: "已暂停", retrying: "等待重试", active: "运行中", starting: "等待首次采集" };
export function SourceCards({ sources }: { sources: PublicSource[] }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sources.map((s) => <article key={s.id} className="card p-5">
    <div className="flex items-start justify-between gap-3"><h3 className="text-[15px] font-semibold">{s.name}</h3><span className={`shrink-0 rounded-mark px-2 py-1 text-[11px] ${s.state === "active" ? "bg-accent-soft text-accent-ink" : "bg-bg-sunk text-ink-3"}`}>{states[s.state] ?? s.state}</span></div>
    <p className="mt-2 text-[12px] text-ink-4">{s.platform}</p>
    {s.requirements.length > 0 && <p className="mt-2 text-[12px] leading-6 text-ink-3">需要配置：{s.requirements.join("、")}</p>}
    {s.note && <p className="mt-2 text-[12px] leading-6 text-ink-3">{s.note}</p>}
    {s.lastSuccessAt && <p className="mt-2 text-[11px] text-ink-4">最近成功：{new Date(s.lastSuccessAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>}
    {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[12px] text-accent hover:underline">来源主页 ↗</a>}
  </article>)}</div>;
}
export default function SourcesPage() {
  const { sources } = useLoaderData<typeof loader>();
  return <div className="py-5 lg:pt-1"><h1 className="text-2xl font-semibold">关注来源</h1><p className="mt-2 text-sm leading-7 text-ink-3">论文与作者动态分别展示，共用 9 个 CV 研究方向。采集只展示摘要和原文链接。</p>
    <h2 className="mt-8 text-lg font-semibold">论文来源</h2><SourceCards sources={sources.filter((s) => s.contentType === "paper")} />
    <div className="mt-8 flex items-center justify-between"><h2 className="text-lg font-semibold">关注的研究作者与社区</h2><Link to="/updates" className="text-sm text-accent">查看研究动态 →</Link></div><SourceCards sources={sources.filter((s) => s.contentType === "post")} />
    <p className="mt-5 text-[13px] leading-6 text-ink-3">小红书：等待确认作者主页与订阅渠道。支持通过 RSS 订阅服务或受保护的外部采集接口接入。</p>
  </div>;
}
