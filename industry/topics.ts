// One directory supplies the navigation, topic pages and model tag vocabulary.
import directory from "./topics.json" with { type: "json" };

export const RESEARCH_TOPICS = directory.topics;
export const RESEARCH_TOPIC_TAGS = RESEARCH_TOPICS.flatMap((topic) => topic.tags);
export const TOPIC_GROUPS = directory.groups;
export const researchTopic = (slug: string | null | undefined) => RESEARCH_TOPICS.find((topic) => topic.slug === slug);

/** Structure owns research labels; preserve the content type and other existing metadata. */
export function mergeResearchTags(existing: readonly string[], classified: readonly string[]): string[] {
  const research = new Set(RESEARCH_TOPIC_TAGS);
  const other = existing.filter((tag) => !research.has(tag));
  return [...new Set([...other.slice(0, 1), ...classified.filter((tag) => research.has(tag)), ...other.slice(1)])];
}
