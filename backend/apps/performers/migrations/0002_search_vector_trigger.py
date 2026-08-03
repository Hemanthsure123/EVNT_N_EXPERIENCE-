"""Keep `Performer.search_vector` current, in the database.

Same approach as `events.0001_initial`, and for the same reasons:

- A TRIGGER rather than application code means the vector can never drift,
  including when a row is written by a path that forgets to update it (a data
  migration, a shell fix, the admin).
- Weights rank a stage-name hit (A) above the tagline, city and genres (B),
  above the bio (C). Somebody searching "sitar" should find the act called
  Sitar Collective before the one whose bio mentions a sitar once.
- The UPDATE trigger is `BEFORE UPDATE OF <source columns>`, so a status-only
  change (submitting, approving, pausing) does not needlessly recompute it.

`genres` and `languages` are JSON arrays, so they are flattened with
`jsonb_array_elements_text` before being fed to `to_tsvector` — searching
"jazz" has to match an act that listed jazz as a genre, which is how most
people will arrive.
"""

from django.db import migrations

_TSV_FORWARD = r"""
CREATE FUNCTION performers_performer_tsv_refresh() RETURNS trigger AS $$
DECLARE
    genre_text text;
    language_text text;
BEGIN
    -- A JSON array of tags is not a tsvector source on its own. `coalesce`
    -- around the aggregate matters: an empty array makes string_agg return
    -- NULL, and concatenating NULL into the vector would blank the whole row.
    SELECT coalesce(string_agg(value, ' '), '') INTO genre_text
    FROM jsonb_array_elements_text(coalesce(NEW.genres, '[]'::jsonb)) AS value;

    SELECT coalesce(string_agg(value, ' '), '') INTO language_text
    FROM jsonb_array_elements_text(coalesce(NEW.languages, '[]'::jsonb)) AS value;

    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.stage_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.tagline, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.city, '')), 'B') ||
        setweight(to_tsvector('english', genre_text), 'B') ||
        setweight(to_tsvector('english', language_text), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.bio, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER performers_performer_tsv_insert
    BEFORE INSERT ON performers_performer
    FOR EACH ROW EXECUTE FUNCTION performers_performer_tsv_refresh();

CREATE TRIGGER performers_performer_tsv_update
    BEFORE UPDATE OF stage_name, tagline, city, genres, languages, bio
    ON performers_performer
    FOR EACH ROW EXECUTE FUNCTION performers_performer_tsv_refresh();
"""

_TSV_REVERSE = r"""
DROP TRIGGER IF EXISTS performers_performer_tsv_update ON performers_performer;
DROP TRIGGER IF EXISTS performers_performer_tsv_insert ON performers_performer;
DROP FUNCTION IF EXISTS performers_performer_tsv_refresh();
"""


class Migration(migrations.Migration):
    dependencies = [("performers", "0001_initial")]

    operations = [migrations.RunSQL(sql=_TSV_FORWARD, reverse_sql=_TSV_REVERSE)]
