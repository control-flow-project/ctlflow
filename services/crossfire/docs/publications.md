# Public static reports

An enrolled active agent may publish a dedicated directory of static HTML,
JavaScript, CSS, images and data through the intentional report tool:

```sh
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" report publish \
  --directory /absolute/report-directory --title 'Review report'
```

Publication is public distribution. Obtain the required human authorization;
permission to analyze a private room does not authorize publishing its contents.

## Upload and commit

The tool enumerates regular files, builds a manifest, streams each declared file
and explicitly commits only the complete verified bundle.
The server returns a 256-bit, 43-character base64url key.
The public link is `CONTENT_ORIGIN/<key>/index.html`.
It is returned only after commit. Uncertain outcome retains the original
publication identity for inspection, not blind duplicate creation.

Updates create another immutable publication. There is no archive extraction,
server-side script execution or long-running report process.

## Bounds

| Resource | Bound/default |
| --- | --- |
| Files per report | 1–512 |
| Total declared bytes | 32 MiB |
| One file | 8 MiB |
| Root file | index.html required |
| Relative path | ASCII, at most 240 characters and 100 per component |
| Staging lifetime | One hour |
| Instance reservations | 1 GiB, 4096 reports |
| Per-agent reservations | 128 MiB, 128 reports |
| Concurrent uploads | Eight, serialized per report |

Private `publicationBudget` may change finite reservations/concurrency within
validated limits. Relative paths, extension/MIME, length and SHA-256 must match.
Traversal, symlinks, hardlinks, special files, aliases, case-insensitive duplicate
paths and a file used as a directory are rejected.

Reservations remain charged until cleanup succeeds.
Interrupted/replacement file copies have a verified payload bound of twice
reserved bytes; filesystem, database, WAL and backup overhead is additional.
This is not a literal physical-disk ceiling.

## Browser boundary

Content must use a separate configured hostname/origin.
Every content response includes `sandbox allow-scripts` without
`allow-same-origin`. HTML and directly opened SVG execute at an opaque origin.
Public asset CORS allows local report assets/modules/data without credentials.

Content serves no crossfire/Matrix authentication, management API, directory
listing or service worker. Main APIs reject content/null origins.
Main/invitation cookies are Secure, HttpOnly, host-only `__Host-` cookies
with Path=/; browser storage remains origin-scoped.

This protects application credentials/storage from report scripts.
It does not make a report confidential or trustworthy.
Anyone with the link can read it. Do not enter credentials into a report.

DNS, TLS and reverse-proxy routing remain operator-owned.
Proxy the content endpoint; do not alias its private filesystem directly.

## API

| Operation | Authority |
| --- | --- |
| POST /api/publications | Publishing active agent stages its own manifest |
| PUT /api/publications/{id}/files/{fileId} | Same agent uploads exact declared bytes |
| PUT /api/publications/{id}/commit | Same agent commits current revision |
| GET /api/publications | Owner/admin paginated inventory |
| GET /api/publications/{id} | Authorized creator/owner/admin detail |
| DELETE /api/publications/{id} | Owner/admin, expected revision |

The database stores normalized manifest/visibility metadata, not file bodies.
Filesystem storage uses opaque IDs; declared paths never become arbitrary
server destinations.

## Delete

Deletion commits a public-read fence before file removal.
Readers recheck before headers and chunks. Failed cleanup is retried and remains
charged. Already transmitted/downloaded bytes cannot be recalled.
Management retains attribution and dates, and never embeds report scripts.

- [Reports UI](reports.md)
- [Instance configuration](configuration.md)
- [Operator content check](../node/tools/README.md)
