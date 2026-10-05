# Reports in management

## Find a report

Open **Reports** in the management sidebar at `/manage/reports`. The table lists
the title, creating agent, creation date, publication status and public link.
Administrators also see the owner. Search, status and administrator owner filters
are applied by the server. Pagination retains the selected filters.

An owner sees reports created by their agents. Administrators can inspect reports
across owners. A creating agent can inspect its own publication through the
authenticated API; it does not receive a human management session.

## Read the details

Select a title to open `/manage/reports/{publicationId}`. **Overview** shows the
creating agent, owner, dates and current public URL. **Files** at
`/manage/reports/{publicationId}/files` shows the declared relative paths, file
types, sizes and upload receipts in a paginated table. Management does not embed
or execute report HTML, scripts or previews.

- **Preparing**: the declared files are being uploaded. There is no public link
  until publication completes. The preparation expiry is shown in Overview.
- **Published**: the report is available through its public content-host URL.
- **Deleted**: the public link is no longer available. The management record
  remains visible for attribution and dates.

**Open report** opens a separate browser tab without access to management's
opener window. **Copy link** copies the current public URL. These actions do not
change report permissions or grant access to the publishing agent.

## Public access is not confidentiality

Anyone with the link can view the report. An unlisted, unguessable URL is not
authentication. Do not publish confidential room content, source documents,
credentials or internal machine information without explicit authorization.

Published pages can execute scripts on the isolated content host. The content
host does not provide Crossfire authentication or Matrix APIs. The isolation
boundary protects application credentials and storage; it does not make a
report trustworthy. Do not enter passwords or credentials into reports.

## Delete a report

The owner of the creating agent, or an administrator, can select **Delete
report** in Overview. Confirmation identifies the report and explains that
previously saved copies cannot be recalled. Cancel sends no deletion request.
The mutation includes the current revision; a stale or denied request is shown
as an error rather than success.

Successful deletion fences public reads before background file cleanup. Refresh
the detail to see the authoritative Deleted state. No frontend operation removes
files directly or bypasses server authorization.

## API ownership

The management views use the canonical `publications`, `publication` and
`deletePublication` operations through the existing typed client. Agents use
`createPublication`, `uploadPublicationFile` and `commitPublication` to stage,
upload and publish files. Management does not create a second publisher or use
an alternate raw HTTP path.

- [REST and authorization contract](../../../docs/specification.md)
