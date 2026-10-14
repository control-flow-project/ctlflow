using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class AgentAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, Actor administrator, Func<long> now)
    {
        var agentId = Identity.Identifier(); var fleetId = Identity.Identifier(); var fleetKey = "test-" + fleetId[..8];
        var saved = Transactions.Run(context, () =>
        {
            context.Principal.Add(new() { Id = agentId, MatrixUserId = "@agent-" + agentId + ":example.test", Kind = "agent", Status = "active", CreatedAt = now() });
            context.Agent.Add(new() { PrincipalId = agentId, PrincipalKind = "agent", OwnerId = owner.PrincipalId, WakeMode = "selected" });
            context.AgentName.Add(new() { Name = "test-" + agentId[..8], AgentId = agentId });
            context.PrincipalRole.Add(new() { PrincipalId = agentId, PrincipalKind = "agent", RoleCode = "agent", AssignedAt = now() });
            context.PrincipalApplication.Add(new() { PrincipalId = agentId, NextCheckAt = now() });
            context.Fleet.Add(new() { Id = fleetId, OwnerId = owner.PrincipalId, FleetKey = fleetKey, Label = "Native test", ControllerName = "Native test", DeliveryEnabled = 1, CreatedAt = now(), UpdatedAt = now() });
            context.FleetInstance.Add(new() { OwnerId = owner.PrincipalId, FleetKey = fleetKey, InstanceKey = "test-agent", AgentId = agentId });
            return Results.Done();
        });
        Equal(saved.IsSuccess, true, "approved fleet-managed agent persistence");
        var authorization = AuthorizationQueries.Ports(context, now);
        Equal(Authorization.Agent(authorization, owner, agentId, "read").IsSuccess, true, "owner sees current agent");
        var other = new Actor(Identity.Identifier(), "human", new NativeAuthentication("@other:example.test"));
        Equal(Authorization.Agent(authorization, other, agentId, "read").IsSuccess, false, "unregistered viewer rejected");
        var wakes = WakeCommands.Ports(context, now);
        var selected = new[] { new WakeSelection(owner.PrincipalId, true) };
        Equal(WakeChanges.Change(wakes, owner, agentId, new(0, "selected", selected), Identity.Identifier()).Value.Revision, 1L, "wake policy revision");
        Equal(WakeCommands.Senders(context, agentId).Value.Single().IncludeAgents, true, "owner agents included in wake selection");
        Equal(WakeChanges.Change(wakes, owner, agentId, new(1, "everyone", selected), Identity.Identifier()).Error.Code, "invalid", "everyone forbids selected audience");
        Equal(WakeChanges.Change(wakes, owner, agentId, new(1, "selected", [new(agentId, false)]), Identity.Identifier()).Error.Code, "invalid", "agent cannot wake itself");
        Equal(WakeChanges.Change(wakes, owner, agentId, new(1, "selected", [new(administrator.PrincipalId, true), new(administrator.PrincipalId, false)]), Identity.Identifier()).Error.Code, "invalid", "duplicate wake identity rejected");
        Equal(Agents.Change(AgentCommands.Ports(context, now), owner, agentId, new(1, "suspended"), Identity.Identifier()).Value.Principal.Revision, 2L, "agent status change");
        var actor = new Actor(agentId, "agent", new NativeAuthentication("@agent-" + agentId + ":example.test"));
        Equal(Authorization.ActiveActor(authorization, actor).Error.Code, "forbidden", "suspended agent cannot authenticate");
        Equal(Agents.Change(AgentCommands.Ports(context, now), owner, agentId, new(2, "active"), Identity.Identifier()).IsSuccess, true, "owner restores agent account");
        var binding = context.FleetInstance.Single(row => row.AgentId == agentId); binding.RetiredAt = now(); context.SaveChanges();
        Equal(Authorization.ActiveActor(authorization, actor).Error.Code, "forbidden", "retired fleet binding cannot authenticate");
        Equal(Authorization.Agent(authorization, owner, agentId, "read").IsSuccess, false, "retired agent removed from current directory");
    }
}
