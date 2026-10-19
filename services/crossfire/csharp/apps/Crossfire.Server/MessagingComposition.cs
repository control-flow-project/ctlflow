using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public static class MessagingComposition
{
    public static MatrixWebServices Web(ApiState state, MatrixConfiguration configuration) => new(state.Configuration.PublicOrigin, configuration.ServerName,
        state.Messaging, state.Now,
        () => { using var database = state.Storage.Open(); return PolicyQueries.Find(database); },
        (id, secret) => { using var database = state.Storage.Open(); return Invitations.Verify(InvitationCommands.Ports(database, state.Now), id, secret).Map(_ => default(Unit)); },
        async (input, invitation, request, cancellation) =>
        {
            using var database = state.Storage.Open();
            return await MemberRegistration.Register(RegistrationQueries.Ports(database, state.Now, state.Messaging, state.RoomOperation), input, invitation, request, cancellation);
        },
        async (token, cancellation) =>
        {
            using var database = state.Storage.Open();
            return await NativeActors.Principal(new(AuthorizationQueries.Ports(database, state.Now), id => MemberQueries.ByBackendUserId(database, id), state.Messaging.Identify), token, cancellation);
        },
        (actor, search, limit) => { using var database = state.Storage.Open(); return Discovery.Principals(DiscoveryQueries.Ports(database, state.Now), actor, new(1, limit, "all", search)); },
        async (actor, user, name, request, cancellation) =>
        {
            using var database = state.Storage.Open(); var member = MemberQueries.Find(database, actor.PrincipalId);
            if (!member.IsSuccess) return Result<Unit>.Fail(member.Error);
            if (member.Value is null || user != member.Value.Principal.BackendUserId) return Results.Fail<Unit>("forbidden", "You can only change your own profile");
            var changed = Members.Change(MemberCommands.Ports(database, state.Now), actor, actor.PrincipalId, new(member.Value.Principal.Revision, DisplayName: name), request);
            return changed.IsSuccess ? await PrincipalApplications.Reconcile(PrincipalApplicationCommands.Ports(database, state.Now, state.Messaging, state.RoomOperation), actor.PrincipalId, cancellation) : Result<Unit>.Fail(changed.Error);
        },
        Transport.Read, Transport.ReadBytes, Transport.Query, InvitationCookies.Read, response => InvitationCookies.Set(response, null));
}
