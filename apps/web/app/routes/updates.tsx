import { researchTopic } from "@aihot/industry/topics";
import type { PoolResponse } from "@aihot/contracts/site";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { apiGet, queryString } from "../lib/api.server";
import { pageMeta, listPath } from "../lib/seo";
import { ResearchTopicTabs, SearchField } from "../features/feed/Filters";
import { DayList, Pagination } from "../features/feed/DayList";
import { SourceCards, type PublicSource } from "./sources";

export async function loader({ request }: { request: Request }) {
  const params = new URL(request.url).searchParams;
  const topic = params.get("topic")?.trim() || null;
  if (topic && !researchTopic(topic)) throw new Response("Not found", { status: 404 });
  const q = params.get("q")?.trim().slice(0, 200) || null;
  const page = Math.max(1, Math.min(50, parseInt(params.get("page") ?? "1", 10) || 1));
  const [data, directory] = await Promise.all([
    apiGet<PoolResponse>(`/api/site/pool${queryString({ contentType: "post", topic, q, page: page > 1 ? page : null })}`, { signal: request.signal }),
    apiGet<{ sources: PublicSource[] }>("/api/site/sources", { signal: request.signal }),
  ]);
  return { data, sources: directory.sources.filter((s) => s.contentType === "post") };
}
export function meta({ loaderData: data }: { loaderData?: Awaited<ReturnType<typeof loader>> }) {
  return pageMeta({ title: "研究动态", description: "CV 研究作者的论文解读、实验经验与研究进展。", path: listPath("/updates", { topic: data?.data.filters.topic, q: data?.data.filters.q, page: data && data.data.page > 1 ? data.data.page : null }), noindex: !!data?.data.filters.q });
}
export function headers() { return { "Cache-Control": "public, max-age=0, s-maxage=30" }; }
export default function UpdatesPage() {
  const { data, sources } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const f = data.filters;
  const href = (page: number) => { const p = new URLSearchParams(params); if (page === 1) p.delete("page"); else p.set("page", String(page)); return `/updates?${p}`; };
  return <div className="pb-8 pt-5 lg:pt-1">
    <div className="flex items-baseline justify-between gap-4"><h1 className="text-2xl font-semibold">研究动态</h1><Link to="/following" className="text-[13px] text-accent hover:underline">关注来源 ↗</Link></div>
    <p className="mt-2 text-sm leading-7 text-ink-3">来自研究作者与社区的论文解读、实验经验和研究进展。</p>
    <div className="research-filters my-5 space-y-4"><ResearchTopicTabs base="/updates" topic={f.topic ?? null} /><SearchField action="/updates" defaultValue={f.q ?? ""} keep={{ topic: f.topic ?? null }} /></div>
    {data.items.length ? <><DayList items={data.items} /><Pagination page={data.page} pageCount={data.pageCount} href={href} /></> :
      <div className="card px-6 py-8"><h2 className="text-base font-semibold">{f.topic || f.q ? "暂时没有匹配的研究动态" : "作者动态等待接入"}</h2><p className="mt-2 text-sm leading-7 text-ink-3">{f.topic || f.q ? "可以切换研究方向或调整搜索词。" : "关注名单已建立。配置采集服务后，后台会定时获取相关帖子，并按 CV 研究方向整理。"}</p></div>}
    <h2 className="mt-8 text-base font-semibold">当前关注</h2><SourceCards sources={sources} />
  </div>;
}
