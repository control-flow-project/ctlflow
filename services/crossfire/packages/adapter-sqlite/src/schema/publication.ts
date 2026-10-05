export const publicationSchema = `
CREATE TABLE publication (
  id TEXT NOT NULL PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent(principal_id),
  public_key TEXT NOT NULL UNIQUE CHECK(length(public_key) = 43 AND public_key NOT GLOB '*[^A-Za-z0-9_-]*'),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  state TEXT NOT NULL CHECK(state IN ('staging','published','deleted')),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  created_at INTEGER NOT NULL CHECK(created_at >= 0),
  expires_at INTEGER NOT NULL CHECK(expires_at > created_at),
  published_at INTEGER,
  deleted_at INTEGER,
  cleaned_at INTEGER,
  total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 0 AND 33554432),
  file_count INTEGER NOT NULL CHECK(file_count BETWEEN 1 AND 512),
  CHECK((state = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK(state != 'published' OR published_at IS NOT NULL),
  CHECK(state != 'staging' OR published_at IS NULL),
  CHECK(cleaned_at IS NULL OR state = 'deleted')
) STRICT;
CREATE INDEX ix_publication_agent_created ON publication(agent_id, created_at DESC, id DESC);
CREATE INDEX ix_publication_created ON publication(created_at DESC, id DESC);
CREATE INDEX ix_publication_cleanup ON publication(state, cleaned_at, expires_at, id);
CREATE INDEX ix_publication_storage ON publication(cleaned_at, agent_id, total_bytes);
CREATE TABLE publication_file (
  id TEXT NOT NULL PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES publication(id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK(length(path) BETWEEN 1 AND 240),
  media_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 0 AND 8388608),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'),
  uploaded INTEGER NOT NULL CHECK(uploaded IN (0,1)),
  UNIQUE(publication_id, path COLLATE NOCASE)
) STRICT;
CREATE INDEX ix_publication_file_manifest ON publication_file(publication_id, uploaded, id);
CREATE TRIGGER protect_publication_file_insert BEFORE INSERT ON publication_file
WHEN (SELECT state FROM publication WHERE id = NEW.publication_id) != 'staging'
BEGIN SELECT RAISE(ABORT, 'Published report files are immutable'); END;
CREATE TRIGGER protect_publication_file_update BEFORE UPDATE ON publication_file
WHEN (SELECT state FROM publication WHERE id = OLD.publication_id) != 'staging' OR NEW.id != OLD.id
 OR NEW.publication_id != OLD.publication_id OR NEW.path != OLD.path OR NEW.media_type != OLD.media_type OR NEW.bytes != OLD.bytes OR NEW.sha256 != OLD.sha256
BEGIN SELECT RAISE(ABORT, 'Published report files are immutable'); END;
CREATE TRIGGER protect_publication_identity BEFORE UPDATE ON publication
WHEN NEW.id != OLD.id OR NEW.agent_id != OLD.agent_id OR NEW.public_key != OLD.public_key OR NEW.title != OLD.title
 OR NEW.created_at != OLD.created_at OR NEW.expires_at != OLD.expires_at OR NEW.total_bytes != OLD.total_bytes OR NEW.file_count != OLD.file_count
 OR (OLD.state = 'deleted' AND NEW.state != 'deleted') OR (OLD.state = 'published' AND NEW.state = 'staging')
BEGIN SELECT RAISE(ABORT, 'Report identity, manifest and deletion fence are immutable'); END;
CREATE TRIGGER validate_publication_commit BEFORE UPDATE OF state ON publication
WHEN NEW.state = 'published' AND (OLD.state != 'staging'
  OR (SELECT count(*) FROM publication_file WHERE publication_id = NEW.id AND uploaded = 1) != NEW.file_count
  OR (SELECT coalesce(sum(bytes),0) FROM publication_file WHERE publication_id = NEW.id) != NEW.total_bytes
  OR NOT EXISTS (SELECT 1 FROM publication_file WHERE publication_id = NEW.id AND path = 'index.html'))
BEGIN SELECT RAISE(ABORT, 'Only a complete staged report can be published'); END;
`;
