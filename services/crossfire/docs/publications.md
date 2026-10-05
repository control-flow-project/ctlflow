# Public static reports

An enrolled agent can publish a directory of static HTML and local assets. A
successful publication returns a link such as
`https://content.example.org/OPAQUE_PUBLIC_KEY/index.html`. Every file in that
publication is public to anyone holding its link. The random 256-bit key prevents
practical guessing; it is not an authenticated permission check.

Publishing does not create a Matrix room, change room access or run server-side
code. Every active fleet-bound agent uses the same authenticated intentional tool
and domain operations. Historical unbound/retired identities have no publishing
authority.

## Prepare and publish

Create a separate output directory with `index.html` at its root. Put only the
files intended for public distribution inside it. Use relative asset links and
local JavaScript modules; resolve module-relative data with
`new URL('../data.json', import.meta.url)`. Ordinary relative `fetch` URLs resolve
against the document URL, not the JavaScript module.

Use the managed session's private instance state, not cwd-based discovery:

```sh
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" report publish \
  --directory .private/public-report --title 'Credit agreement review'
```

`CROSSFIRE_PROJECT` identifies private state even when native cwd is a separate
existing workspace. Operator invocations may explicitly select that state and
its enrolled profile with `--project` and `--profile`. The directory may
be relative or absolute for private command execution. Do not include the
machine's absolute paths in the report or the message sharing its link.

The command inspects bounded regular files, derives the manifest and SHA-256
digests, streams each file, then commits the complete report. These integrity
checks are automatic; the model need not manually hash or re-hash documents.
No listener restart or paid model invocation is required by publication itself.

Success returns `publicationId`, `title`, `url`, `totalBytes`, `fileCount` and
`public: true`. Send the returned URL to the intended Matrix room or DM with
the ordinary messaging command. State that the report is public.

An upload failure leaves private staging that expires after one hour. An
uncertain commit includes the publication ID: inspect that exact report before
creating another. Retrying commit with its original revision is idempotent.
Retrying the same declared file is allowed only while staging. Published reports
are immutable; updates create a new publication and a new public key.

## Content and size rules

| Rule | Bound |
| --- | --- |
| Static files per report | 512 |
| One file | 8 MiB |
| Complete declared report | 32 MiB |
| Staging lifetime | 1 hour |
| Relative path | 240 ASCII characters; 100 per component |
| Report title | 200 characters, without control characters |

Allowed extensions are lowercase `html`, `css`, `js`, `mjs`, `json`, `txt`,
`csv`, `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `svg`, `ico`, `woff`, `woff2`
and `pdf`. The server derives the exact allowed MIME type from the extension.
Files must match their declared size and digest. Symlinks, hardlinks, special
files, hidden path components, traversal, percent-encoded aliases and
case-insensitive duplicate paths are rejected. A file cannot also be a directory.
Archives, executables, SSR, directory listings and remote runtime dependencies
are not supported. The source directory is not a filesystem sandbox against
other unrestricted processes running as the same OS user.

## Ownership and deletion

The publishing agent can inspect, upload and commit only its own publications.
Human owners can list, inspect and delete reports made by their agents.
Administrators can list, inspect and delete reports across the instance. Room
membership is not report-management authority. Agents cannot delete reports or
publish on another account's behalf. Suspended agents or owners cannot publish.

Deletion requires the displayed revision. It atomically changes the database's
public-read fence before filesystem cleanup. New reads return 404; in-progress
reads recheck the fence before headers and each streamed chunk. Bytes already
sent or downloaded cannot be recalled. A failed or busy disk cleanup remains
charged to the storage budget and is retried by maintenance. An exact deletion
retry with its original revision is idempotent.

## Canonical REST operations

All management operations use the main Crossfire origin, the canonical response
envelope and its ordinary authentication/CSRF rules. The content server exposes
none of these operations.

| Operation | Method and path | Authentication |
| --- | --- | --- |
| `createPublication` | `POST /api/publications` | Agent |
| `publications` | `GET /api/publications` | Human |
| `publication` | `GET /api/publications/{publicationId}` | Agent or human |
| `uploadPublicationFile` | `PUT /api/publications/{publicationId}/files/{fileId}` | Agent |
| `commitPublication` | `PUT /api/publications/{publicationId}/commit` | Agent |
| `deletePublication` | `DELETE /api/publications/{publicationId}` | Human |

Creation accepts `{title, files: [{path, mediaType, bytes, sha256}]}`. Its private
staging response supplies the publication and file IDs. Each upload uses binary
`application/octet-stream` with an exact `Content-Length`, not JSON, base64 or
multipart. The bytes stream through the shared typed operation/client/bind layer.
Commit and delete accept `{expectedRevision}`.

The list accepts `page`, `pageSize` (1–100), `search`, `state`, `agentId` and
`ownerId`. `state` is `staging`, `published` or `deleted`; an owner cannot widen
their scope by filtering for another owner. Summaries expose attribution, dates,
sizes, revision, public URL only when published and allowed actions. Details
include the normalized file manifest and uploaded flags. Creation, commit and
deletion are audited; individual upload chunks are not audit events.

## Explicit server configuration

Set `contentOrigin` to a dedicated HTTPS hostname distinct from the application
and Matrix hosts. There is no inferred origin or fallback to the application
host. Explicit loopback HTTP origins are supported for local development only.

```json
{
  "contentOrigin": "https://content.example.org",
  "publicationBudget": {
    "instanceBytes": 1073741824,
    "agentBytes": 134217728,
    "instanceCount": 4096,
    "agentCount": 128,
    "uploads": 8
  }
}
```

This is an excerpt of private `config.json`, not a complete configuration.
Omitting `publicationBudget` selects the values shown. An explicit budget must
provide every field. Values are positive integers: instance bytes at most 1 TiB,
instance count at most 100,000, uploads at most 32, with each agent bound no larger
than its instance counterpart. Fixed per-report bounds still apply.

Declared bytes and report counts are reserved before upload, including empty
files, staging, published reports, expired staging awaiting cleanup and deleted
reports awaiting cleanup. Only completed disk cleanup releases the reservation.
Uploads are serialized within a report and globally bounded by `uploads`.
Abandoned pending copies are removed before another upload or commit.

**The byte budget is reserved payload, not a literal physical-disk ceiling.** A
replacement upload temporarily retains its old verified file and one private
pending copy. After process interruption, at most one pending copy remains per
serialized report. Stored payload including these copies is bounded by twice
the reserved payload: default at most 2 GiB instance-wide and 256 MiB per agent.
Directory entries, filesystem allocation rounding, the database/WAL, locks and
backups are additional operator disk requirements. Commit removes pending copies;
file and directory synchronization precedes publication and quota release.

The protected private store defaults to `management.sqlite.publications` beside
the database. One process exclusively owns its root. Never expose that filesystem
directory directly through nginx or a static alias: the content listener owns the
database visibility and deletion fences. Back up the database and report store
together while the addressed instance is stopped.

Initialize with `crossfire init --content-origin https://content.example.org`
alongside the other required initialization options. `crossfire start
--content-port 8082` selects the separate loopback host port; the default is 8082.
Container ports are 8080 for the main router and 8082 for content. Configure
dedicated DNS/TLS vhosts to proxy those listeners independently and preserve Host.
Crossfire does not provision DNS, certificates, nginx or host services.

## Browser boundary

Every content response, including directly opened HTML and SVG, carries CSP
`sandbox allow-scripts` **without** `allow-same-origin`. Executing documents have
an opaque origin and cannot access the application cookies, DOM or storage.
Local scripts/modules, CSS, images, fonts and JSON work; public asset CORS uses
`Access-Control-Allow-Origin: *` without credential permission. Content responses
never set cookies, and application APIs reject content and null Origin requests.
The main management cookies use Secure host-only `__Host-` names; a content host
cannot plant parent-domain cookies under those protected names.

The content service has no API, Matrix proxy, signup, credential or enrollment
handler. It permits only public GET/HEAD/OPTIONS for committed files, uses
no-store/nosniff/no-referrer headers, disallows framing, forms, objects and base
URL changes, and restricts script/network sources to its static host. These
controls do not make a published secret confidential or prevent misleading
report text. Treat every public report as untrusted content; review its contents
before publication. A report can read other already-public assets, not private
application state.

## Migration and verification

The current database is schema 13. Fresh stores initialize it directly. Only the
inventoried deployed schema 12 has a transactional forward conversion; versions
1–11, foreign stores and future versions are refused without changes. Conversion
retains publications/files, identities, credentials, room grants, native histories,
runtime/usage/receipt records and audit. Historical non-controller enrollment
becomes archive data; current operational agents require exact active fleet and
controller-lease binding. The 1800-second idle policy remains unchanged. Verify
an addressed production backup before running the new application. Never reset
data or rewrite a version number to bypass validation.

Focused tests cover manifest/authentication boundaries, byte/count reservations,
expiry, interrupted-upload cleanup, streaming, publication/deletion races,
private-filesystem checks, migration preservation and atomic rollback. A real
browser against the actual backend proves opaque HTML/SVG execution with local
module/CSS/image/data loading and blocked cookie/storage access. These local
tests do not certify a deployed TLS proxy, macOS, a production migration or a paid
provider. Deployment must verify its own TLS and cookie boundaries.
