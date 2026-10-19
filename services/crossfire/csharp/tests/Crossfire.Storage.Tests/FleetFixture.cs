using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public sealed record ManagedAgent(string AgentId, string FleetId, string FleetKey, string CredentialId, string ConnectionId, string RunId, Actor Actor);

public static class FleetFixture
{
    public static ManagedAgent Create(CrossfireDbContext context, Actor owner, long now)
    {
        var agentId = Identity.Identifier(); var fleetId = Identity.Identifier(); var fleetKey = "test-" + fleetId[..8];
        var credential = Identity.Identifier(); var connection = Identity.Identifier(); var run = Identity.Identifier();
        var matrixId = "@agent-" + agentId + ":example.test";
        var saved = Transactions.Run(context, () =>
        {
            context.Principal.Add(new() { Id = agentId, BackendUserId = matrixId, Kind = "agent", Status = "active", CreatedAt = now });
            context.Agent.Add(new() { PrincipalId = agentId, PrincipalKind = "agent", OwnerId = owner.PrincipalId, WakeMode = "selected" });
            context.AgentName.Add(new() { Name = "test-" + agentId[..8], AgentId = agentId });
            context.PrincipalRole.Add(new() { PrincipalId = agentId, PrincipalKind = "agent", RoleCode = "agent", AssignedAt = now });
            context.PrincipalApplication.Add(new() { PrincipalId = agentId, NextCheckAt = now });
            context.Fleet.Add(new() { Id = fleetId, OwnerId = owner.PrincipalId, FleetKey = fleetKey, Label = "Native test", ControllerName = "Native test", DeliveryEnabled = 1, CreatedAt = now, UpdatedAt = now });
            context.FleetInstance.Add(new() { OwnerId = owner.PrincipalId, FleetKey = fleetKey, InstanceKey = "test-agent", AgentId = agentId });
            context.FleetCredential.Add(new() { Id = credential, FleetId = fleetId, SecretHash = Identity.Hash(Identity.Secret()), CreatedAt = now });
            context.FleetConnection.Add(new() { FleetId = fleetId, ConnectionId = connection, CredentialId = credential, LastSeenAt = now, ExpiresAt = now + 3600000 });
            context.ListenerRun.Add(new() { Id = run, AgentId = agentId, Release = "test-release", ControllerFleetId = fleetId,
                ControllerConnectionId = connection, ControllerCredentialId = credential, StartedAt = now, LastSeenAt = now });
            return Results.Done();
        });
        Equal(saved.IsSuccess, true, "fleet/controller/listener fixture persistence");
        return new(agentId, fleetId, fleetKey, credential, connection, run, new(agentId, "agent", new NativeAuthentication(matrixId)));
    }
}
