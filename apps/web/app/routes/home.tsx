import { researchTopic } from "@aihot/industry/topics";
import { HOME } from "@aihot/industry/site";
import { Link, data as withHeaders, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { TimelineResponse } from "@aihot/contracts/site";
import { isCategoryKey, isChannelKey } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString, releaseBoundCache } from "../lib/api.server";
import { listPath, organizationLd, pageMeta } from "../lib/seo";
import { Wordmark } from "../components/Logo";
import { TimelinePage } from "../features/feed/TimelinePage";
import { Pagination } from "../features/feed/DayList";
import { HotTopics } from "../features/feed/HotTopics";
import { ResearchTopicTabs, SearchField } from "../features/feed/Filters";
import { beijingDate, beijingWeekday } from "../lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const channel = isChannelKey(channelParam) ? channelParam : "all";
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const topic = url.searchParams.get("topic")?.trim() || null;
  if (topic && !researchTopic(topic)) throw new Response("Not found", { status: 404 });
  const tag = url.searchParams.get("tag")?.trim() || null;
  const contentType = "paper" as const;
  const requestedPage = Number(url.searchParams.get("page") ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
  const upstream = new Headers();
  const data = await loadOr404<TimelineResponse>(`/api/site/timeline${queryString({ channel: channel === "all" ? null : channel, category, tag, topic, contentType, page, limit: 20 })}`, { responseHeaders: upstream, signal: request.signal });
  if (data.pagination && data.pagination.page !== page) {
    url.searchParams.set("page", String(data.pagination.page));
    throw redirect(`${url.pathname}${url.search}`);
  }
  return withHeaders({ data, filters: { channel, category, tag, topic, contentType } }, { headers: releaseBoundCache(data.refreshAt, 60, Date.now(), upstream) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.filters;
  const path = listPath("/", { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, tag: f?.tag, topic: f?.topic, page: loaderData?.data.pagination && loaderData.data.pagination.page > 1 ? loaderData.data.pagination.page : null });
  return pageMeta({ path, jsonLd: path === "/" ? organizationLd() : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function TodayLabel() {
  const today = beijingDate(Date.now());
  const [, m, d] = today.split("-").map(Number) as [number, number, number];
  return (
    <span className="text-[12.5px] text-ink-4" suppressHydrationWarning>
      {m}月{d}日 · {beijingWeekday(today).replace("星期", "周")}
    </span>
  );
}

/** A decorative wireframe: focus window, depth planes and feature points. */
function VisionField() {
  return (
    <svg viewBox="0 0 320 240" className="vision-field" fill="none" aria-hidden="true">
      <g stroke="currentColor" opacity="0.16">
        {[40, 80, 120, 160, 200, 240, 280].map((x) => <path key={x} d={`M${x} 12v216`} />)}
        {[40, 80, 120, 160, 200].map((y) => <path key={y} d={`M12 ${y}h296`} />)}
      </g>
      <path d="M58 72V38h34M228 38h34v34M262 168v34h-34M92 202H58v-34" stroke="currentColor" strokeWidth="3" />
      <g stroke="currentColor" strokeWidth="1.2">
        <path d="m160 51 68 38v72l-68 38-68-38V89Z" opacity="0.8" />
        <path d="m92 89 68 39 68-39M160 128v71M126 70l68 39v71M194 70l-68 39v71M92 125l68 38 68-38" opacity="0.5" />
        <path d="m126 109 68 0-34 54Z" opacity="0.5" />
      </g>
      {[[160,51],[228,89],[228,161],[160,199],[92,161],[92,89],[160,128],[126,109],[194,109],[160,163]].map(([cx,cy], i) => <circle key={i} cx={cx} cy={cy} r={i === 6 ? 5 : 3} fill="currentColor" />)}
      <path d="M38 128h244" stroke="currentColor" strokeDasharray="3 5" opacity="0.45" />
    </svg>
  );
}

export default function Home() {
  const { data, filters } = useLoaderData<typeof loader>();
  const paging = data.pagination;
  const pageHref = (page: number) => `${listPath("/", { channel: filters.channel !== "all" ? filters.channel : null, category: filters.category, tag: filters.tag, topic: filters.topic, page: page > 1 ? page : null })}#papers`;
  const activeTopic = researchTopic(filters.topic);
  const title = activeTopic?.name ?? (filters.tag ? `#${filters.tag}` : HOME.feedTitle);
  return (
    <div className="research-home pb-6">
      <div className="flex h-16 items-center justify-between lg:hidden">
        <Wordmark size={21} className="text-ink" />
        <TodayLabel />
      </div>
      <header className="research-hero">
        <div className="relative z-10 max-w-[640px]">
          <p className="mono text-[10px] font-medium tracking-[0.16em] text-[#91cfc6] sm:text-[11px]">{HOME.eyebrow}</p>
          <h1 className="mt-4 text-[28px] font-semibold leading-[1.3] tracking-tight sm:text-[34px] lg:text-[38px]">{HOME.headline.map((line) => <span key={line} className="inline-block whitespace-nowrap">{line}</span>)}</h1>
          <p className="mt-3 max-w-[390px] text-[14px] leading-7 text-[#bccfce]">{HOME.intro}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[11px] sm:text-[12px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5"><span className="size-1.5 rounded-full bg-[#83e1cb]" />{HOME.source}</span>
            <span className="text-[#adc8c4]">{HOME.scope}</span>
          </div>
        </div>
        <VisionField />
      </header>
      <section id="papers" aria-label={HOME.feedTitle}>
        <div className="mb-4 mt-8 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[21px] font-bold tracking-tight">{title}</h2>
            <span className="hidden text-[12px] text-ink-4 sm:inline">按收录时间排列</span>
          </div>
          <Link to={filters.topic ? `/all?topic=${filters.topic}` : "/all"} className="text-[13px] font-medium text-accent hover:underline">{HOME.allTitle} <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="research-filters mb-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-ink-4">研究方向 <span className="ml-2">交叉研究可属于多个主题</span></p>
            <SearchField keep={{ topic: filters.topic, category: filters.category, tag: filters.tag }} />
          </div>
          <ResearchTopicTabs base="/" topic={filters.topic} />
        </div>
        {activeTopic && <p className="mb-4 text-[13px] leading-6 text-ink-3">{activeTopic.definition}</p>}
        {data.hot && <HotTopics entries={data.hot} />}
        {paging && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 [&_nav]:mt-0">
          <p className="text-[13px] text-ink-3">共 {paging.total} 条 · 每页 {paging.pageSize} 条 · 第 {paging.page} / {paging.pageCount} 页</p>
          <Pagination page={paging.page} pageCount={paging.pageCount} href={pageHref} />
        </div>}
        <TimelinePage key={JSON.stringify([filters, paging?.page])} data={data} />
        {paging && <Pagination page={paging.page} pageCount={paging.pageCount} href={pageHref} />}
      </section>
    </div>
  );
}
