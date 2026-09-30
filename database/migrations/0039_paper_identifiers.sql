-- Cross-provider paper identifiers preserve existing article URLs and IDs.
CREATE TABLE paper_identifiers (
  identifier text PRIMARY KEY,
  article_id text NOT NULL REFERENCES articles(id) ON DELETE CASCADE
);
CREATE INDEX paper_identifiers_article_idx ON paper_identifiers(article_id);
INSERT INTO paper_identifiers (identifier, article_id)
SELECT DISTINCT ON (identifier) identifier, id FROM (
  SELECT id, discovered_at, 'arxiv:' || lower(regexp_replace(regexp_replace(
    substring(url from '(?i)^https?://(?:export\.)?arxiv\.org/(?:abs|pdf)/([^?#]+)'), '\.pdf$', '', 'i'), 'v[0-9]+$', '', 'i')) AS identifier
  FROM articles WHERE url ~* '^https?://(export\.)?arxiv\.org/(abs|pdf)/'
) a WHERE identifier IS NOT NULL ORDER BY identifier, discovered_at, id
ON CONFLICT DO NOTHING;
INSERT INTO budgets (service, per_minute, per_hour, per_day, note)
VALUES ('openalex', 5, 30, 100, 'OpenAlex metadata requests; never fetch paid full text')
ON CONFLICT DO NOTHING;
