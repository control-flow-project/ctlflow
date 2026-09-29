import { operations } from '../../../../../packages/contracts/src/rest/operations.js';
import { readMember, listMembers, readInvitation, listInvitations } from '../../../../../packages/domain/src/member/read-member.js';
import { changeMember } from '../../../../../packages/domain/src/member/change-member.js';
import { createMemberInvitation, revokeMemberInvitation } from '../../../../../packages/domain/src/member/invitation.js';
import { acceptMemberInvitation } from '../../../../../packages/domain/src/member/accept-invitation.js';
import { bind, reply, paged, actor, acknowledged } from '../bind.js';
import { member } from '../representation/identity.js';
import { invitation } from '../representation/enrollment.js';
export function memberRoutes() {
  return [
    bind(operations.members, (context, _params, query) => paged(listMembers(context.services, actor(context), query), member)),
    bind(operations.member, (context, params) => reply(readMember(context.services, actor(context), params.memberId), member)),
    bind(operations.changeMember, (context, params, _query, input) => {
      const result = changeMember(context.services, actor(context), params.memberId, input, context.requestId);
      return reply(result, member);
    }),
    bind(operations.memberRole, (context, params, _query, input) => {
      const result = changeMember(context.services, actor(context), params.memberId, input, context.requestId);
      return reply(result, member);
    }),
    bind(operations.createInvitation, (context, _params, _query, input) => reply(createMemberInvitation(context.services, actor(context), input, context.requestId),
      value => ({ invitationId: value.invitationId, claimSecret: value.claimSecret, expiresAt: value.expiresAt,
        signupUrl: context.services.instance.publicOrigin + '/manage/signup/' + value.invitationId + '#' + value.claimSecret }))),
    bind(operations.invitations, (context, _params, query) => paged(listInvitations(context.services, actor(context), query), invitation)),
    bind(operations.invitation, (context, params) => reply(readInvitation(context.services, actor(context), params.invitationId), invitation)),
    bind(operations.revokeInvitation, (context, params) => acknowledged(revokeMemberInvitation(context.services, actor(context), params.invitationId, context.requestId))),
    bind(operations.acceptInvitation, async (context, params, _query, input) => reply(await acceptMemberInvitation(context.services, params.invitationId, input, context.requestId))),
  ];
}
