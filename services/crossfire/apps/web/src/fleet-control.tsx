import { useState } from 'react';
import type { FleetView } from '@crossfire/contracts/schema/response';
import { call, operations, useAction, useResource } from './api.js';
import { useSession } from './session.js';
import { Alert, Empty, Field, Loaded, Panel, Pagination, Status, timestamp } from './ui.js';

export function FleetDelivery({ fleet }: { fleet: FleetView }) {
  const viewer = useSession(), action = useAction(), [body, setBody] = useState(''), [accepted, setAccepted] = useState('');
  const [request, setRequest] = useState<{ messageId: string; body: string }>();
  const enabled = fleet.delivery.deliveryEnabled, online = fleet.delivery.connection.status === 'online';
  const query = new URLSearchParams({ page: new URLSearchParams(location.search).get('messagesPage') ?? '1', pageSize: '10' });
  const messages = useResource(operations.fleetMessages, { fleetId: fleet.fleetId }, query.toString(), 5000);
  return <><Panel title="Fleet delivery" description="Control all fleet-bound listeners without stopping their engines or the controller.">
    <dl><dt>Controller connection</dt><dd><Status value={fleet.delivery.connection.status}/></dd>
      <dt>Delivery</dt><dd><Status value={enabled ? 'Enabled' : 'Deactivated'}/></dd>
      <dt>Last controller contact</dt><dd>{fleet.delivery.connection.lastSeenAt === null ? 'Not connected yet' : timestamp(fleet.delivery.connection.lastSeenAt)}</dd></dl>
    <div className="actions"><button disabled={action.pending} onClick={() => {
      if (confirm(enabled ? 'Deactivate this fleet’s listeners? Engines stay running. Unread messages are retained.' : 'Activate this fleet’s listeners? Delivery resumes when its controller is connected.')) {
        void action.run(() => call(operations.changeFleetDelivery, { fleetId: fleet.fleetId }, { expectedRevision: fleet.revision, enabled: !enabled }, viewer.csrfSecret));
      }
    }}>{enabled ? 'Deactivate fleet' : 'Activate fleet'}</button></div>
    <p className="support">Connection loss pauses fleet-bound delivery. Direct listeners are independent. Reactivation retains the same native sessions.</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!confirm('Send this message to every enrolled agent in this fleet? Running bound listeners receive it directly, without room wake-up filtering. Unavailable agents are skipped.')) return;
      const input = request?.body === body ? request : { messageId: crypto.randomUUID(), body };
      setRequest(input);
      void action.run(() => call(operations.createFleetMessage, { fleetId: fleet.fleetId }, input, viewer.csrfSecret), result => {
        setAccepted('Queued for ' + result.total + ' agents. Receipt outcomes appear below.'); setBody(''); setRequest(undefined); messages.refresh();
      });
    }}><Field label="Message the fleet">{id => <textarea id={id} required maxLength={4096} rows={3} value={body} onChange={event => { setBody(event.target.value); setAccepted(''); }}/>}</Field>
      <div className="actions"><button disabled={action.pending || !enabled || !online || !body.trim()}>Send to fleet</button><span role="status">{accepted}</span></div></form>
    <Alert>{action.error}</Alert></Panel>
    <Panel title="Fleet messages" description="Native input receipts, not completed model work. Delivery expires after ten minutes.">
      <Loaded {...messages} retry={messages.refresh}>{page => <>{page.data.length ? <div className="table-wrap"><table aria-label="Fleet messages"><thead><tr><th>Message</th><th>Sent</th><th>Delivered</th><th>Pending</th><th>Skipped</th><th>Failed</th><th>Expired</th></tr></thead><tbody>
        {page.data.map(message => <tr key={message.messageId}><td><span className="fleet-message-body">{message.body}</span></td><td>{timestamp(message.createdAt)}</td><td>{message.delivered} / {message.total}</td><td>{message.pending}</td><td>{message.skipped}</td><td>{message.failed}</td><td>{message.expired}</td></tr>)}</tbody></table></div>
        : <Empty title="No fleet messages">Messages sent from here or the fleet CLI appear here.</Empty>}<Pagination meta={page.meta} parameter="messagesPage"/></>}</Loaded></Panel></>;
}
