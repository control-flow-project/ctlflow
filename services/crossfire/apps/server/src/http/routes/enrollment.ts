import { operations } from '@crossfire/contracts/rest/operations';
import { preflightEnrollment } from '@crossfire/domain/enrollment/preflight';
import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';
import { decideEnrollment } from '@crossfire/domain/enrollment/decide';
import { exchangeEnrollment } from '@crossfire/domain/enrollment/exchange';
import { listEnrollments, readEnrollment } from '@crossfire/domain/enrollment/read-enrollment';
import { listFleets, readFleet, listFleetAgents } from '@crossfire/domain/fleet/read-fleet';
import { changeFleet, removeFleet, bindFleetAgent } from '@crossfire/domain/fleet/change-fleet';
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
    bind(operations.removeFleet, (context, params, _query, input) => acknowledged(removeFleet(context.services, actor(context), params.fleetId, input.expectedRevision, context.requestId))),
    bind(operations.fleetAgents, (context, params, query) => paged(listFleetAgents(context.services, fleetActor(context), params.fleetId, query),
      value => ({ instanceKey: value.instanceKey, agent: agent(value.agent) }))),
    bind(operations.bindFleetAgent, async (context, params, _query, input) => acknowledged(await bindFleetAgent(context.services, fleetActor(context), params.fleetId, params.agentId, { ...input, remove: false }, context.requestId))),
    bind(operations.unbindFleetAgent, async (context, params, _query, input) => acknowledged(await bindFleetAgent(context.services, fleetActor(context), params.fleetId, params.agentId, { ...input, remove: true }, context.requestId))),
  ];
}
