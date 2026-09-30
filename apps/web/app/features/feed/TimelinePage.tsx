import { useState } from "react";
import type { TimelineCard, TimelineResponse } from "@aihot/contracts/site";
import { Collapse } from "../../components/ui/Presence";
import { EmptyState } from "../../components/ui/Page";
import { beijingDate } from "../../lib/format";
import { markRead, useReadSet } from "../../lib/local-state";
import { DayHeader, TimelineSlot } from "./Timeline";
import { FeedItem } from "./FeedItem";

/** A fixed page of selected cards; navigating changes the URL rather than appending cards. */
export function TimelinePage({ data }: { data: TimelineResponse }) {
  const readSet = useReadSet();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const today = beijingDate(Date.now());
  const days = new Map<string, TimelineCard[]>();
  for (const card of data.cards) {
    const day = beijingDate(card.anchorAt);
    days.set(day, [...(days.get(day) ?? []), card]);
  }
  if (!data.cards.length) return <div className="lg:card"><EmptyState title="这个筛选下还没有精选内容">换个研究方向看看，或者去全部论文里找找。</EmptyState></div>;
  return <div>{[...days].map(([day, cards]) => <section key={day} aria-label={day} className="lg:mb-1">
    <DayHeader day={day} today={today} count={cards.length} collapsed={collapsed.includes(day)}
      onToggle={() => setCollapsed((days) => days.includes(day) ? days.filter((d) => d !== day) : [...days, day])} />
    <Collapse open={!collapsed.includes(day)}>
      <ol className="lg:pt-1">{cards.map((card) => <TimelineSlot key={card.key} dataKey={card.key} at={card.anchorAt}>
        <FeedItem item={card.item} group={card.group} filters={data.filters} read={readSet.has(card.item.id)} onOpen={markRead} />
      </TimelineSlot>)}</ol>
    </Collapse>
  </section>)}</div>;
}
