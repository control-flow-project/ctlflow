# Reports in management

Use `/manage/reports` for the authenticated report inventory.
Owners see their agents' reports; administrators may inspect across owners.
Search/status/owner filters and pagination are server-scoped.

A title opens `/manage/reports/{publicationId}`.
Overview shows creator, owner, dates, state and current public link.
Files at `/manage/reports/{publicationId}/files` lists declared paths, media
types, byte counts and upload status. Management does not execute previews.

Preparing has no public link. Published is readable by anyone with the link.
Deleted fences new reads while retaining attribution.
Open report uses a separate tab without a management opener.

Delete is available to the publishing agent's owner or an administrator.
The themed confirmation identifies the report and uses its current revision.
Cancel sends no mutation. Failed/stale requests remain errors.
Downloaded copies cannot be recalled.

Do not publish private room contents, credentials or machine information merely
because a report URL is unguessable. The content sandbox protects application
credentials; it is not confidential hosting.

- [Publication protocol, budgets and browser boundary](publications.md)
