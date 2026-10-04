import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { PublicSource } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
export type { PublicSource } from "@aihot/contracts/site";

export async function loader({ request }: { request: Request }) {
  return apiGet<{ sources: PublicSource[] }>("/api/site/sources", { signal: request.signal });
}
export function meta() { return pageMeta({ title: "关注来源", description: "CVFetch 的论文库、研究作者与采集状态。", path: "/following" }); }
export function headers() { return { "Cache-Control": "public, max-age=0, s-maxage=30" }; }
const states: Record<string, string> = { pending: "待配置", paused: "已暂停", retrying: "等待重试", active: "最近正常", starting: "等待首次采集", delayed: "更新延迟" };
const needsAttention = (s: PublicSource) => ["pending", "retrying", "delayed"].includes(s.state);
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const cadence = (minutes: number) => minutes % 1440 === 0 ? `每 ${minutes / 1440} 天检查` : minutes % 60 === 0 ? `每 ${minutes / 60} 小时检查` : `每 ${minutes} 分钟检查`;

export function SourceCards({ sources }: { sources: PublicSource[] }) {
  return <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{sources.map((s) => <article key={s.id} className="card flex flex-col p-5">
    <div className="flex items-start justify-between gap-3"><div><p className="mb-2 text-[11px] font-medium tracking-wide text-ink-4">{s.platform}</p><h3 className="text-[16px] font-semibold leading-6">{s.name}</h3></div>
      <span className={`mt-1 shrink-0 rounded-full px-2.5 py-1 text-[11px] ${s.state === "active" ? "bg-accent-soft text-accent-ink" : ["retrying", "delayed"].includes(s.state) ? "bg-hot-soft text-hot" : "bg-bg-sunk text-ink-3"}`}>{states[s.state]}</span></div>
    {s.note && <p className="mt-3 text-[12px] leading-6 text-ink-3">{s.note}</p>}
    {s.requirements.length > 0 ? <div className="mt-4 rounded-control bg-bg-sunk p-3 text-[12px] leading-6 text-ink-3">等待配置：{s.requirements.join("、")}。配置完成并启用后开始更新。</div> : <>
      <div className="mt-4 flex items-end justify-between border-t border-line-soft pt-4"><div><span className="num text-2xl font-semibold">{s.publicCount}</span><span className="ml-2 text-[11px] text-ink-4">公开收录</span></div><span className="text-[11px] text-ink-4">{cadence(s.intervalMinutes)}</span></div>
      {s.archive && <div className="mt-4"><div className="mb-2 flex justify-between text-[11px] text-ink-4"><span>会议目录进度</span><span className="num">{s.archive.processed} / {s.archive.total}</span></div><progress aria-label={`${s.name}会议目录进度`} value={s.archive.processed} max={s.archive.total} className="block h-1.5 w-full overflow-hidden rounded-full accent-[var(--accent)]" /><p className="mt-1.5 text-[10px] text-ink-4">已扫描条目数，未通过筛选的论文不计入公开收录。</p></div>}
      {s.issue && <p className="mt-3 text-[12px] leading-6 text-hot">{s.issue}</p>}
      {s.state === "delayed" && <p className="mt-2 text-[12px] leading-6 text-ink-3">已超过计划检查时间，请确认运行机器与网络在线。</p>}
      <dl className="mt-4 space-y-1.5 text-[11px] text-ink-4"><div className="flex justify-between gap-2"><dt>最近成功</dt><dd>{s.lastSuccessAt ? date(s.lastSuccessAt) : "暂无"}</dd></div>{s.nextCheckAt && <div className="flex justify-between gap-2"><dt>计划检查</dt><dd>{date(s.nextCheckAt)}</dd></div>}</dl>
    </>}
    {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-auto pt-4 text-[12px] font-medium text-accent hover:underline">访问来源 ↗</a>}
  </article>)}</div>;
}
export default function SourcesPage() {
  const { sources } = useLoaderData<typeof loader>();
  const [attentionOnly, setAttentionOnly] = useState(false);
  const visible = attentionOnly ? sources.filter(needsAttention) : sources;
  const papers = visible.filter((s) => s.contentType === "paper");
  const posts = visible.filter((s) => s.contentType === "post");
  return <div className="pb-8 pt-5 lg:pt-1">
    <div className="flex items-baseline justify-between gap-4"><h1 className="text-2xl font-semibold">关注来源</h1><Link to="/" className="text-[13px] text-accent">阅读论文 ↗</Link></div>
    <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-3">从预印本、学术索引到会议档案。这里可以查看更新节奏、公开收录和等待接入的作者。</p>
    <div className="my-6 grid grid-cols-3 gap-3">{[["论文来源", sources.filter((s) => s.contentType === "paper").length], ["最近正常", sources.filter((s) => s.state === "active").length], ["等待接入", sources.filter((s) => s.state === "pending").length]].map(([label, count]) => <div key={label} className="card p-4 sm:p-5"><p className="text-[12px] text-ink-4">{label}</p><p className="num mt-2 text-2xl font-semibold text-ink">{count}</p></div>)}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft pb-4"><div className="inline-flex gap-1 rounded-full bg-bg-sunk p-1">{[false, true].map((only) => <button key={String(only)} type="button" aria-pressed={attentionOnly === only} onClick={() => setAttentionOnly(only)} className={`rounded-full px-4 py-2 text-[12px] font-medium ${attentionOnly === only ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>{only ? `待处理 ${sources.filter(needsAttention).length}` : "全部来源"}</button>)}</div><span className="text-[11px] text-ink-4">时间为北京时间 · 刷新页面查看最新状态</span></div>
    {papers.length > 0 && <section className="mt-6"><h2 className="text-base font-semibold">论文库与会议</h2><SourceCards sources={papers} /></section>}
    {posts.length > 0 && <section className="mt-8"><div className="flex items-center justify-between"><h2 className="text-base font-semibold">研究作者与社区</h2><Link to="/updates" className="text-[13px] text-accent">研究动态 →</Link></div><SourceCards sources={posts} /></section>}
    {!visible.length && <p className="card mt-6 p-6 text-sm text-ink-3">当前没有需要处理的来源。</p>}
    <p className="mt-6 text-[12px] leading-6 text-ink-4">同一论文可能被多个来源收录，站内会按标识去重。小红书等待确认作者主页与订阅渠道；只展示摘要和原文链接。</p>
  </div>;
}
