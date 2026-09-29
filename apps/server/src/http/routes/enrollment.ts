import { operations } from '../../../../../packages/contracts/src/rest/operations.js';
import { preflightEnrollment } from '../../../../../packages/domain/src/enrollment/preflight.js';
import { introduceEnrollment } from '../../../../../packages/domain/src/enrollment/introduce.js';
import { decideEnrollment } from '../../../../../packages/domain/src/enrollment/decide.js';
import { exchangeEnrollment } from '../../../../../packages/domain/src/enrollment/exchange.js';
import { listEnrollments, readEnrollment } from '../../../../../packages/domain/src/enrollment/read-enrollment.js';
import { listFleets, readFleet } from '../../../../../packages/domain/src/fleet/read-fleet.js';
import { bind, reply, paged, actor } from '../bind.js';
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
    bind(operations.fleet, (context, params) => reply(readFleet(context.services, actor(context), params.ownerId, params.fleetKey),
      value => ({ fleet: view.fleet(value.fleet), instances: value.instances.map(instance => ({ instanceKey: instance.instanceKey, agent: agent(instance.agent) })) }))),
  ];
}
