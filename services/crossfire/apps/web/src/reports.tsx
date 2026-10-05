import type { PublicationDetails, PublicationSummary } from '@crossfire/contracts/publication';
import { call, operations, useAction, useResource } from './api.js';
import { OwnerFilter } from './agent-filters.js';
import { filterQuery } from './form.js';
import { useSession } from './session.js';
import { Alert, CopyText, Empty, Field, Help, Loaded, Page, PageItems, Panel, Pagination, Status, SubjectHeading, ViewNavigation, timestamp } from './ui.js';

const stateLabels = { staging: 'Preparing', published: 'Published', deleted: 'Deleted' } as const;
function reportSize(bytes: number): string {
  if (bytes < 1024) return bytes.toLocaleString() + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' KiB';
  return (bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MiB';
}
function ReportFilters() {
  const viewer = useSession(), query = new URLSearchParams(location.search);
  return <form className="filter-bar" onSubmit={event => { event.preventDefault(); location.assign('/manage/reports?' + filterQuery(event.currentTarget)); }}>
    <label>Search reports<input name="search" type="search" maxLength={200} defaultValue={query.get('search') ?? ''}/></label>
    <Field label="Publication status">{id => <select id={id} name="state" defaultValue={query.get('state') ?? ''}>
      <option value="">All statuses</option><option value="published">Published</option><option value="staging">Preparing</option><option value="deleted">Deleted</option>
    </select>}</Field>
    {viewer.permissions.includes('publication.read.any') && <OwnerFilter/>}
    {query.has('agentId') && <input type="hidden" name="agentId" value={query.get('agentId') ?? ''}/>}
    <div className="filter-actions"><button>Search</button><a href="/manage/reports">Reset</a></div>
  </form>;
}
function ReportRow({ report, owners }: { report: PublicationSummary; owners: boolean }) {
  return <tr><td><a className="record-link" href={'/manage/reports/' + report.id}>{report.title}</a>
    <span className="subline">{report.fileCount} {report.fileCount === 1 ? 'file' : 'files'} · {reportSize(report.totalBytes)}</span></td>
    <td><a href={'/manage/agents/' + report.agentId}>{report.agentName}</a></td>{owners && <td>{report.ownerName}</td>}
    <td>{timestamp(report.createdAt)}{report.publishedAt !== null && <span className="subline">Published {timestamp(report.publishedAt)}</span>}</td>
    <td><Status value={stateLabels[report.state]}/></td>
    <td>{report.state === 'published' && report.url ? <a href={report.url} target="_blank" rel="noopener noreferrer" aria-label={'Open report ' + report.title}>Open report ↗</a> : <span className="muted">No public link</span>}</td>
  </tr>;
}
export function Reports() {
  const viewer = useSession(), resource = useResource(operations.publications, {}, location.search);
  const owners = viewer.permissions.includes('publication.read.any');
  return <Page title="Reports" description="Public reports published by your agents. Anyone with a report’s link can view it." action={<button onClick={resource.refresh}>Refresh</button>}>
    <ReportFilters/><Loaded {...resource} retry={resource.refresh}>{page => <>{page.data.length ? <div className="table-wrap report-table">
      <table aria-label="Reports"><thead><tr><th scope="col">Report</th><th scope="col">Created by</th>{owners && <th scope="col">Owner</th>}<th scope="col">Created</th><th scope="col">Status</th><th scope="col">Public link</th></tr></thead>
        <tbody>{page.data.map(report => <ReportRow key={report.id} report={report} owners={owners}/>)}</tbody></table></div>
      : <Empty title="No matching reports">Ask an agent to publish a report, or adjust the filters.</Empty>}<Pagination meta={page.meta}/></>}</Loaded>
    <Help title="Publishing and public access"><p>Agents publish a directory of HTML, scripts, images and other supported files through Crossfire. Reports open on a separate content host, never inside management.</p>
      <p>The link is unlisted, not private. Do not publish confidential documents or credentials without explicit authorization. Owners can delete reports created by their agents; administrators can delete any report.</p>
      <p>Deleting a report stops its public link from working. It cannot remove copies that someone has already saved.</p></Help>
  </Page>;
}
function ReportOverview({ report, refresh }: { report: PublicationDetails; refresh(): void }) {
  const viewer = useSession(), action = useAction();
  return <><Panel title="Public access" description="An unlisted link is not access control. Anyone who has it can view this report.">
    {report.state === 'published' && report.url ? <><a className="button" href={report.url} target="_blank" rel="noopener noreferrer">Open report ↗</a>
      <CopyText label="Public URL" value={report.url} rows={2} buttonLabel="Copy link" copiedMessage="Link copied. Anyone with it can view this report." failureMessage="Clipboard access was blocked. Select the URL above and copy it manually."/></>
      : <p>{report.state === 'deleted' ? 'This report has been deleted. Its public link is no longer available.' : 'This report is still being prepared. No public link is available until every declared file is uploaded and publication completes.'}</p>}
    <p className="support">Published pages can run scripts. Open only reports you trust; do not enter passwords or credentials into them.</p>
  </Panel><Panel title="Publication details"><dl><dt>Created by</dt><dd><a href={'/manage/agents/' + report.agentId}>{report.agentName}</a></dd><dt>Owner</dt><dd>{report.ownerName}</dd>
    <dt>Created</dt><dd>{timestamp(report.createdAt)}</dd><dt>Published</dt><dd>{report.publishedAt === null ? 'Not published' : timestamp(report.publishedAt)}</dd>
    {report.state === 'staging' && <><dt>Preparation expires</dt><dd>{timestamp(report.expiresAt)}</dd></>}
    {report.deletedAt !== null && <><dt>Deleted</dt><dd>{timestamp(report.deletedAt)}</dd></>}
    <dt>Files</dt><dd>{report.fileCount.toLocaleString()} · {reportSize(report.totalBytes)}</dd></dl>
  </Panel>{report.state !== 'deleted' && report.allowedActions.includes('delete') && <Panel title="Delete report" description="Remove its public link and report files. Saved copies cannot be recalled.">
    <button type="button" className="danger" disabled={action.pending} onClick={() => {
      if (confirm('Delete report “' + report.title + '”? Its public link will stop working. Copies already saved by others cannot be removed.')) {
        void action.run(() => call(operations.deletePublication, { publicationId: report.id }, { expectedRevision: report.revision }, viewer.csrfSecret), refresh);
      }
    }}>Delete report</button><Alert>{action.error}</Alert>
  </Panel>}</>;
}
function ReportFiles({ report }: { report: PublicationDetails }) {
  return <Panel title="Files" description="The declared static files in this report. Paths are relative to the report directory.">
    <PageItems items={report.files} parameter="filesPage">{files => <div className="table-wrap report-table"><table aria-label="Report files">
      <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Upload receipt</th></tr></thead>
      <tbody>{files.map(file => <tr key={file.id}><td><code>{file.path}</code></td><td>{file.mediaType}</td><td>{reportSize(file.bytes)}</td><td><Status value={file.uploaded ? 'Recorded' : 'Pending'}/></td></tr>)}</tbody>
    </table></div>}</PageItems>
  </Panel>;
}
export function ReportDetail({ id, section }: { id: string; section: 'overview' | 'files' }) {
  const resource = useResource(operations.publication, { publicationId: id });
  return <Page title="Report details" description="Public access, creating agent and report files." action={<button onClick={resource.refresh}>Refresh</button>}>
    <a className="back" href="/manage/reports">← Reports</a><Loaded {...resource} retry={resource.refresh}>{({ data: report }) => <>
      <SubjectHeading name={report.title} description={<>Created by <a href={'/manage/agents/' + report.agentId}>{report.agentName}</a> · {report.ownerName}</>}>
        <Status value={stateLabels[report.state]}/></SubjectHeading>
      <ViewNavigation label="Report sections" items={[{ label: 'Overview', href: '/manage/reports/' + id, current: section === 'overview' },
        { label: 'Files', href: '/manage/reports/' + id + '/files', current: section === 'files' }]}/>
      {section === 'overview' ? <ReportOverview report={report} refresh={resource.refresh}/> : <ReportFiles report={report}/>}
    </>}</Loaded>
  </Page>;
}
