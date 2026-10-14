using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.EntityFrameworkCore;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class FleetAcceptance
{
    public static void Verify(CrossfireDbContext context, Actor owner, Actor administrator, long time)
    {
        var now = time;
        var fixture = FleetFixture.Create(context, owner, now);
        var ports = FleetCommands.Ports(context, () => now);
        var actor = new FleetPrincipalActor(owner);
        var controller = new FleetControllerActor(fixture.FleetId, fixture.CredentialId);
        var secret = FleetAuthority.ControllerToken(fixture.CredentialId, Identity.Secret());
        var saved = Transactions.Run(context, () =>
        {
            var id = fixture.CredentialId;
            context.FleetCredential.Single(row => row.Id == id).SecretHash = Identity.Hash(secret);
            return Results.Done();
        });
        Equal(saved.IsSuccess, true, "controller credential fixture");
        Equal(FleetAuthority.Authenticate(ports, secret).Value, controller, "exact controller token authentication");
        Equal(FleetAuthority.Authenticate(ports, secret + "0").Error.Code, "unauthorized", "modified controller token rejection");
        Equal(FleetAuthority.Find(ports, new FleetPrincipalActor(fixture.Actor), fixture.FleetId).Error.Code, "forbidden", "agent cannot control fleet");
        Equal(FleetControl.ReportConnection(ports, controller, fixture.FleetId, Identity.Identifier(), false).Error.Code, "conflict", "live generation cannot be replaced");
        Equal(FleetControl.ReportConnection(ports, actor, fixture.FleetId, fixture.ConnectionId, false).Error.Code, "forbidden", "human cannot report controller lease");
        Equal(FleetControl.ReportConnection(ports, controller, fixture.FleetId, fixture.ConnectionId, false).Value.Connection.Status, "online", "controller heartbeat renews lease");
        var operationId = Identity.Identifier();
        var request = new FleetOperationRequest(operationId, fixture.AgentId, "stop", 0, false);
        Equal(FleetOperations.Request(ports, actor, fixture.FleetId, request, Identity.Identifier()).Value.Status, "pending", "scoped stop request");
        Equal(FleetOperations.Request(ports, actor, fixture.FleetId, request, Identity.Identifier()).Value.OperationId, operationId, "lifecycle request idempotence");
        Equal(FleetOperations.Request(ports, actor, fixture.FleetId, request with { Action = "start" }, Identity.Identifier()).Error.Code, "conflict", "lifecycle ID cannot change action");
        Equal(FleetOperations.Request(ports, actor, fixture.FleetId, request with { OperationId = Identity.Identifier(), ExpectedRevision = 1 }, Identity.Identifier()).Error.Code,
            "conflict", "single pending fleet operation");
        Equal(FleetOperations.Receipt(ports, controller, fixture.FleetId, operationId, new(fixture.ConnectionId, "succeeded", null)).Error.Code, "conflict", "receipt requires claimed lifecycle operation");
        Equal(FleetOperations.Claim(ports, controller, fixture.FleetId, operationId, fixture.ConnectionId).Value.Status, "running", "controller claims lifecycle");
        now += FleetValues.ControllerLeaseMs;
        Equal(FleetOperations.Receipt(ports, controller, fixture.FleetId, operationId, new(fixture.ConnectionId, "succeeded", null)).Error.Code, "conflict", "expired controller cannot complete lifecycle");
        Equal(FleetControl.ReportConnection(ports, controller, fixture.FleetId, fixture.ConnectionId, false).Error.Code, "conflict", "expired generation requires new connection ID");
        var replacement = Identity.Identifier();
        Equal(FleetControl.ReportConnection(ports, controller, fixture.FleetId, replacement, false).IsSuccess, true, "expired lease admits new generation");
        Equal(FleetOperations.Receipt(ports, controller, fixture.FleetId, operationId, new(replacement, "succeeded", null)).Error.Code, "conflict", "new generation must reclaim lifecycle");
        Equal(FleetOperations.Claim(ports, controller, fixture.FleetId, operationId, replacement).Value.Status, "running", "new generation reclaims lifecycle");
        Equal(FleetOperations.Receipt(ports, controller, fixture.FleetId, operationId, new(replacement, "succeeded", null)).Value, true, "lifecycle receipt independent of old listener");
        Equal(FleetOperations.Receipt(ports, controller, fixture.FleetId, operationId, new(replacement, "succeeded", null)).Value, true, "repeat final lifecycle receipt");
        Equal(FleetOperations.Receipt(ports, controller, fixture.FleetId, operationId, new(replacement, "failed", "different")).Error.Code, "conflict", "final outcome is immutable");
        Equal(FleetOperations.List(ports, new FleetPrincipalActor(administrator), fixture.FleetId, 1, 1).Value.TotalItems, 1L, "administrator scoped lifecycle page");
        Equal(FleetOperations.List(ports, actor, fixture.FleetId, 2, 1).Value.Items.Count, 0, "native lifecycle paging captures offset");
        Equal(FleetOperations.Request(ports, actor, fixture.FleetId, request with { OperationId = Identity.Identifier(), Action = "reset", ExpectedRevision = 1 }, Identity.Identifier()).Error.Code,
            "invalid", "fresh history requires confirmation");
        var messages = FleetMessageCommands.Ports(context, () => now);
        var messageId = Identity.Identifier();
        Equal(FleetMessages.Create(messages, actor, fixture.FleetId, messageId, "Resume the reviewed task", Identity.Identifier()).Value.Pending, 1, "fleet broadcast creates exact recipient");
        Equal(FleetMessages.Create(messages, actor, fixture.FleetId, messageId, "Resume the reviewed task", Identity.Identifier()).Value.Total, 1, "fleet broadcast retry does not duplicate");
        Equal(FleetMessages.Create(messages, actor, fixture.FleetId, messageId, "Changed", Identity.Identifier()).Error.Code, "conflict", "broadcast ID binds original body");
        Equal(FleetMessages.Create(messages, actor, fixture.FleetId, Identity.Identifier(), "\ufeff", Identity.Identifier()).Error.Code, "invalid", "ECMAScript blank fleet message rejection");
        Equal(FleetMessages.Create(messages, actor, fixture.FleetId, Identity.Identifier(), "bad\u0001input", Identity.Identifier()).Error.Code, "invalid", "fleet message controls rejected");
        var snapshot = FleetMessages.Control(messages, controller, fixture.FleetId, replacement).Value;
        Equal(snapshot.Messages.Count, 1, "control exposes one pending broadcast");
        Equal(snapshot.Messages[0].Sender.MatrixUserId, ((NativeAuthentication)owner.Authentication!).MatrixUserId, "broadcast source provenance");
        Equal(snapshot.Messages[0].AgentIds[0], fixture.AgentId, "broadcast exact target");
        Equal(FleetMessages.Receipt(messages, actor, fixture.FleetId, messageId, fixture.AgentId, "delivered", null).Error.Code, "forbidden", "human cannot fabricate native broadcast receipt");
        Equal(FleetMessages.Receipt(messages, controller, fixture.FleetId, messageId, fixture.AgentId, "failed", null).Error.Code, "invalid", "failure receipt requires error");
        Equal(FleetMessages.Receipt(messages, controller, fixture.FleetId, messageId, fixture.AgentId, "delivered", null).Value, true, "receipt acknowledges fleet delivery");
        Equal(FleetMessages.Receipt(messages, controller, fixture.FleetId, messageId, fixture.AgentId, "delivered", null).Value, true, "broadcast receipt idempotence");
        Equal(FleetMessages.Receipt(messages, controller, fixture.FleetId, messageId, fixture.AgentId, "failed", "changed").Error.Code, "conflict", "broadcast final receipt immutable");
        Equal(FleetMessages.Control(messages, controller, fixture.FleetId, replacement).Value.Messages.Count, 0, "delivered broadcast leaves control queue");
        Equal(FleetMessages.List(messages, actor, fixture.FleetId, 1, 1).Value.Items[0].Delivered, 1, "fleet delivery summary from stored receipts");
        var expireId = Identity.Identifier();
        now++;
        Equal(FleetMessages.Create(messages, controller, fixture.FleetId, expireId, "Controller message", Identity.Identifier()).IsSuccess, true, "controller broadcast same domain path");
        now += FleetMessageValues.LifetimeMs;
        Equal(FleetMessages.List(messages, actor, fixture.FleetId, 1, 1).Value.Items[0].Expired, 1, "expired broadcasts distinct from pending");
        Equal(FleetControl.Delivery(ports, actor, fixture.FleetId, 0, false, Identity.Identifier()).Error.Code, "stale_revision", "fleet delivery uses displayed revision");
        var failing = ports with { Audit = _ => Results.Fail<Unit>("unavailable", "audit unavailable") };
        Equal(FleetControl.Delivery(failing, actor, fixture.FleetId, 1, false, Identity.Identifier()).Error.Code, "unavailable", "audit failure propagates");
        Equal(FleetQueries.Find(context, fixture.FleetId).Value?.DeliveryEnabled, true, "expected domain failure rolls back fleet intent");
        Equal(FleetControl.Delivery(ports, actor, fixture.FleetId, 1, false, Identity.Identifier()).Value.DeliveryEnabled, false, "fleet pause persists separately from sessions");
        Equal(FleetMessages.Create(messages, actor, fixture.FleetId, Identity.Identifier(), "No wake", Identity.Identifier()).Error.Code, "conflict", "paused fleet cannot enqueue broadcasts");
        Equal(Transactions.Run(context, () =>
        {
            var id = fixture.AgentId;
            context.FleetInstance.Single(row => row.AgentId == id).RetiredAt = now;
            context.Principal.Single(row => row.Id == id).Status = "suspended";
            return Results.Done();
        }).IsSuccess, true, "retired identity fixture");
        Equal(AuthorizationQueries.AgentView(context, fixture.AgentId).Value is not null, true, "raw identity lookup retains retired agent for cleanup and restoration");
        Equal(Authorization.Agent(ports.Authorization, owner, fixture.AgentId, "read").Error.Code, "missing", "retired identity does not become management read authority");
    }
}
