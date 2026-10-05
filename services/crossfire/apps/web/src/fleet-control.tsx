import { useState } from 'react';
import type { FleetView } from '@ctlflow/crossfire-contracts/schema/response';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Help, Loaded, Panel, Pagination, Status, timestamp } from './ui.js';
import { canManageFleet } from './fleet-authority.js';

function MessageText({ body }: { body: string }) {
  const excerpt = Array.from(body).slice(0, 160).join('');
  return excerpt === body ? <span className="fleet-message-body">{body}</span>
    : <details className="fleet-message-preview"><summary>{excerpt.trimEnd()}…</summary><p className="fleet-message-body">{body}</p></details>;
}
export function FleetDelivery({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction(), enabled = fleet.delivery.deliveryEnabled;
  return <Panel title="Fleet delivery" description="Pause new input without stopping sessions or the controller.">
    <div className="delivery-summary"><Status value={enabled ? 'Enabled' : 'Paused'}/><p>{enabled ? 'Delivery is enabled while the controller is connected and sessions are eligible.' : 'New delivery is paused. Unread messages and saved histories are retained.'}</p></div>
    <div className="actions"><button disabled={action.pending || !canManageFleet(viewer, fleet)} onClick={() => {
      if (confirm(enabled ? 'Pause this fleet’s delivery? Sessions keep running. Unread messages are retained.' : 'Resume this fleet’s delivery? Input resumes for eligible agents when the controller is connected. Stopped sessions remain stopped.')) {
        void action.run(() => call(operations.changeFleetDelivery, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision, enabled: !enabled }, viewer.csrfSecret));
      }
    }}>{enabled ? 'Pause delivery' : 'Resume delivery'}</button></div><Alert>{action.error}</Alert>
    <Help title="Connection and recovery"><dl><dt>Controller</dt><dd><Status value={fleet.delivery.connection.status}/></dd><dt>Last contact</dt><dd>{fleet.delivery.connection.lastSeenAt === null ? 'Not connected yet' : timestamp(fleet.delivery.connection.lastSeenAt)}</dd></dl>
      <p>Controller connection loss blocks delivery for every agent in this fleet. Reconnection retains the same identities and histories; it never overrides a stopped session.</p></Help>
  </Panel>;
}
export function FleetMessages({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction(), [body, setBody] = useState(''), [accepted, setAccepted] = useState('');
  const [request, setRequest] = useState<{ messageId: string; body: string }>();
  const enabled = fleet.delivery.deliveryEnabled, online = fleet.delivery.connection.status === 'online';
  const query = new URLSearchParams({ page: new URLSearchParams(location.search).get('messagesPage') ?? '1', pageSize: '10' });
  const messages = useResource(operations.fleetMessages, { fleetId: fleet.fleetId }, query.toString(), 5000);
  return <><Panel title="Send a message" description="Send one message directly to its enrolled agents, without room wake-up filtering.">
    {(!enabled || !online) && <p className="support plan-warning">{!enabled ? 'Resume fleet delivery before sending.' : 'The controller must reconnect before sending.'}</p>}
    <form onSubmit={event => {
      event.preventDefault();
      if (!confirm('Send this message to every enrolled agent in this fleet? Ready bindings receive it without room wake-up filtering. Sleeping sessions may resume. Stopped or unavailable agents are skipped.')) return;
      const input = request?.body === body ? request : { messageId: crypto.randomUUID(), body };
      setRequest(input);
      void action.run(() => call(operations.createFleetMessage, { fleetId: fleet.fleetId }, input, viewer.csrfSecret), result => {
        const query = new URLSearchParams(location.search); query.set('messagesPage', '1');
        window.history.replaceState(null, '', location.pathname + '?' + query);
        setAccepted('Queued for ' + result.total + ' agents. Receipt outcomes appear below.'); setBody(''); setRequest(undefined); messages.refresh();
      });
    }}><Field label="Message the fleet">{id => <textarea id={id} required maxLength={4096} rows={3} value={body} onChange={event => { setBody(event.target.value); setAccepted(''); }}/>}</Field>
      <div className="actions"><button disabled={action.pending || !canManageFleet(viewer, fleet) || !enabled || !online || !body.trim()}>Send to fleet</button><span role="status">{accepted}</span></div></form>
    <Alert>{action.error}</Alert></Panel>
    <Panel title="Fleet messages" description="Native input receipts, not completed model work. Delivery expires after ten minutes.">
      <Loaded {...messages} retry={messages.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Fleet messages"><thead><tr><th>Message</th><th>Sent</th><th>Delivered</th><th>Pending</th><th>Skipped</th><th>Failed</th><th>Expired</th></tr></thead><tbody>
        {page.data.map(message => <tr key={message.messageId}><td><MessageText body={message.body}/></td><td>{timestamp(message.createdAt)}</td><td>{message.delivered} / {message.total}</td><td>{message.pending}</td><td>{message.skipped}</td><td>{message.failed}</td><td>{message.expired}</td></tr>)}</tbody></table></div>
        : <Empty title="No fleet messages">Messages sent from here or the fleet CLI appear here.</Empty>}<Pagination meta={page.meta} parameter="messagesPage"/></>}</Loaded></Panel></>;
}
