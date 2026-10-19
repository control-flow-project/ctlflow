using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class AuthenticationAcceptance
{
    public static async Task Verify(CrossfireDbContext context, Actor owner, Actor administrator, long now)
    {
        var fixture = FleetFixture.Create(context, owner, now);
        var ports = new NativeActorPorts(AuthorizationQueries.Ports(context, () => now), id => MemberQueries.ByBackendUserId(context, id), (token, cancellation) =>
            ValueTask.FromResult(token switch
            {
                "agent-token" => Result<string>.Success(((NativeAuthentication)fixture.Actor.Authentication!).BackendUserId),
                "human-token" => Result<string>.Success(((NativeAuthentication)owner.Authentication!).BackendUserId),
                "unregistered-token" => Result<string>.Success("@unknown:example.test"),
                _ => Results.Fail<string>("unauthorized", "Invalid native identity")
            }));
        Equal((await NativeActors.Agent(ports, "agent-token")).Value.PrincipalId, fixture.AgentId, "agent authentication verifies registered native identity");
        Equal((await NativeActors.Agent(ports, "human-token")).Error.Message, "Registered agent authentication is required", "human native token cannot authenticate as agent");
        Equal((await NativeActors.Principal(ports, "unregistered-token")).Error.Message, "Registered identity authentication is required", "native registration alone grants no Crossfire authority");
        Equal((await NativeActors.Agent(ports, "bad-token")).Error.Code, "unauthorized", "native token denial propagates");
        Equal(OwnerScopes.Read(ports.Authorization, owner, "agent.read").Value, owner.PrincipalId, "ordinary owner scope cannot expand");
        Equal(OwnerScopes.Read(ports.Authorization, owner, "agent.read", administrator.PrincipalId).Error.Code, "forbidden", "foreign owner filter does not grant access");
        Equal(OwnerScopes.Read(ports.Authorization, administrator, "agent.read").Value is null, true, "administrator can request complete owner scope");
        Equal(OwnerScopes.Read(ports.Authorization, administrator, "agent.read", owner.PrincipalId).Value, owner.PrincipalId, "administrator can filter one owner explicitly");
        Equal(Transactions.Run(context, () =>
        {
            var id = fixture.AgentId;
            context.FleetInstance.Single(row => row.AgentId == id).RetiredAt = now;
            return Results.Done();
        }).IsSuccess, true, "retired authentication fixture");
        Equal((await NativeActors.Agent(ports, "agent-token")).Error.Code, "forbidden", "valid native token cannot bypass retired fleet registration");
        Equal(OwnerScopes.Read(ports.Authorization, fixture.Actor, "agent.read").Error.Code, "forbidden", "retired actor cannot acquire directory scope");
    }
}
