import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { preflightEnrollment } from '@ctlflow/crossfire-domain/enrollment/preflight';
import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';
import { decideEnrollment } from '@ctlflow/crossfire-domain/enrollment/decide';
import { exchangeEnrollment } from '@ctlflow/crossfire-domain/enrollment/exchange';
import { listEnrollments, readEnrollment } from '@ctlflow/crossfire-domain/enrollment/read-enrollment';
import { listFleets, readFleet, listFleetAgents } from '@ctlflow/crossfire-domain/fleet/read-fleet';
import { changeFleet } from '@ctlflow/crossfire-domain/fleet/change-fleet';
import { archiveFleet, removeFleetAgent } from '@ctlflow/crossfire-domain/fleet/retire';
import { recordNativeStop } from '@ctlflow/crossfire-domain/fleet/native-stop';
import { bind, reply, paged, actor, fleetActor, acknowledged } from '../bind.js';
import * as view from '../representation/enrollment.js';
import { agent } from '../representation/identity.js';
export function enrollmentRoutes() {
  return [
    bind(operations.preflight, async (context, _params, _query, input) => reply(await preflightEnrollment(context.services, input))),
    bind(operations.introduceEnrollment, async (context, _params, _query, input) => reply(await introduceEnrollment(context.services, input),
      value => ({ enrollment: view.enrollmentDetails(value), approvalUrl: context.services.instance.publicOrigin + '/manage/enrollments/' + value.request.id }))),
    bind(operations.enrollments, (context, _params, query) => paged(listEnrollments(context.services, actor(context), query), view.enrollment)),
    bind(operations.enrollment, (context, params) => reply(readEnrollment(context.services, actor(context), params.enrollmentId), view.enrollmentDetails)),
    bind(operations.decideEnrollment, (context, params, _query, input) => reply(decideEnrollment(context.services, actor(context), params.enrollmentId, input, context.requestId))),
    bind(operations.exchangeEnrollment, (context, params, _query, input) => reply(exchangeEnrollment(context.services, params.enrollmentId, input.claimSecret))),
    bind(operations.fleets, (context, _params, query) => paged(listFleets(context.services, actor(context), query), view.fleet)),
    bind(operations.fleet, (context, params) => reply(readFleet(context.services, fleetActor(context), params.fleetId), view.fleet)),
    bind(operations.changeFleet, (context, params, _query, input) => reply(changeFleet(context.services, fleetActor(context), params.fleetId, input, context.requestId), view.fleet)),
    bind(operations.archiveFleet, (context, params, _query, input) => acknowledged(archiveFleet(context.services, actor(context), params.fleetId, input.expectedRevision, context.requestId))),
    bind(operations.fleetAgents, (context, params, query) => paged(listFleetAgents(context.services, fleetActor(context), params.fleetId, query),
      value => ({ instanceKey: value.instanceKey, agent: agent(value.agent) }))),
    bind(operations.removeFleetAgent, async (context, params, _query, input) => acknowledged(await removeFleetAgent(context.services, fleetActor(context), params.fleetId, params.agentId, input, context.requestId))),
    bind(operations.recordFleetNativeStop, (context, params, _query, input) => reply(recordNativeStop(context.services, fleetActor(context), params.fleetId, params.agentId, input))),
  ];
}
