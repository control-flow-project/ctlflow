using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class FleetMessages
{
    public static Result<FleetMessageSummary> Create(FleetMessagePorts ports, FleetActor actor, string fleetId, string messageId, string body, string requestId)
    {
        if (TextRules.Blank(body) || body.Length > 4096 || Encoding.UTF8.GetByteCount(body) > FleetMessageValues.MaxBytes
            || body.Any(character => character <= '\b' || character is '\v' or '\f' || character >= '\u000e' && character <= '\u001f' || character == '\u007f'))
            return Results.Fail<FleetMessageSummary>("invalid", "Fleet message must contain plain text of 1–4096 characters and at most 16 KiB");
        return ports.Fleet.Transaction.Run(() =>
        {
            var fleet = FleetAuthority.Find(ports.Fleet, actor, fleetId, true);
            if (!fleet.IsSuccess) return Result<FleetMessageSummary>.Fail(fleet.Error);
            var author = actor is FleetPrincipalActor principal ? principal.Identity.PrincipalId : null;
            var credential = actor is FleetControllerActor controller ? controller.CredentialId : null;
            var previous = ports.Find(messageId);
            if (!previous.IsSuccess) return Result<FleetMessageSummary>.Fail(previous.Error);
            if (previous.Value is not null)
            {
                if (previous.Value.FleetId != fleetId || previous.Value.Body != body || previous.Value.AuthorPrincipalId != author || previous.Value.AuthorCredentialId != credential)
                    return Results.Fail<FleetMessageSummary>("conflict", "Message ID belongs to a different request");
                return ports.Deliveries([messageId]).Map(values => FleetMessageValues.Summary(previous.Value, values, ports.Fleet.Authorization.Now()));
            }
            var connection = ports.Fleet.Connection(fleetId);
            if (!connection.IsSuccess) return Result<FleetMessageSummary>.Fail(connection.Error);
            var now = ports.Fleet.Authorization.Now();
            if (!fleet.Value.DeliveryEnabled || FleetValues.Connection(connection.Value, now).Status != "online")
                return Results.Fail<FleetMessageSummary>("conflict", "Activate this fleet and connect its controller before sending a message");
            var count = ports.PendingCount(fleetId, now);
            if (!count.IsSuccess) return Result<FleetMessageSummary>.Fail(count.Error);
            if (count.Value >= 32) return Results.Fail<FleetMessageSummary>("capacity", "This fleet already has 32 pending messages");
            var bindings = ports.Fleet.Bindings(fleet.Value);
            if (!bindings.IsSuccess) return Result<FleetMessageSummary>.Fail(bindings.Error);
            if (bindings.Value.Count == 0) return Results.Fail<FleetMessageSummary>("conflict", "This fleet has no enrolled agents");
            var agents = ports.Recipients(bindings.Value.Select(value => value.AgentId).ToArray());
            if (!agents.IsSuccess) return Result<FleetMessageSummary>.Fail(agents.Error);
            if (agents.Value.Count != bindings.Value.Count || agents.Value.Count > 100)
                return Results.Fail<FleetMessageSummary>("conflict", "Fleet roster is incomplete or exceeds its bound");
            var active = agents.Value.Where(value => value.Status == "active").Select(value => value.AgentId).ToHashSet(StringComparer.Ordinal);
            var message = new FleetMessage(messageId, fleetId, author, credential, body, now, checked(now + FleetMessageValues.LifetimeMs));
            var saved = ports.Insert(message);
            if (!saved.IsSuccess) return Result<FleetMessageSummary>.Fail(saved.Error);
            var deliveries = new List<FleetMessageDelivery>(bindings.Value.Count);
            foreach (var binding in bindings.Value)
            {
                var eligible = active.Contains(binding.AgentId);
                var delivery = new FleetMessageDelivery(messageId, binding.AgentId, eligible ? "pending" : "skipped", eligible ? null : now, eligible ? null : "Agent account is not active");
                var inserted = ports.InsertDelivery(delivery);
                if (!inserted.IsSuccess) return Result<FleetMessageSummary>.Fail(inserted.Error);
                deliveries.Add(delivery);
            }
            return ports.Fleet.Audit(FleetValues.Audit(actor, requestId, fleet.Value, "fleet.message.create", messageId))
                .Map(_ => FleetMessageValues.Summary(message, deliveries, now));
        });
    }

    public static Result<Page<FleetMessageSummary>> List(FleetMessagePorts ports, FleetActor actor, string fleetId, int page, int pageSize)
    {
        var fleet = FleetAuthority.Find(ports.Fleet, actor, fleetId);
        if (!fleet.IsSuccess) return Result<Page<FleetMessageSummary>>.Fail(fleet.Error);
        var records = ports.Page(fleetId, page, pageSize);
        if (!records.IsSuccess) return Result<Page<FleetMessageSummary>>.Fail(records.Error);
        return ports.Deliveries(records.Value.Items.Select(value => value.Id).ToArray()).Map(deliveries =>
            new Page<FleetMessageSummary>(records.Value.Items.Select(message => FleetMessageValues.Summary(message,
                deliveries.Where(value => value.MessageId == message.Id).ToArray(), ports.Fleet.Authorization.Now())).ToArray(), page, pageSize, records.Value.TotalItems));
    }

    public static Result<FleetControlSnapshot> Control(FleetMessagePorts ports, FleetActor actor, string fleetId, string connectionId)
    {
        var current = FleetAuthority.Live(ports.Fleet, actor, fleetId, connectionId);
        if (!current.IsSuccess) return Result<FleetControlSnapshot>.Fail(current.Error);
        var pendingOperation = ports.Fleet.PendingOperation(fleetId);
        if (!pendingOperation.IsSuccess) return Result<FleetControlSnapshot>.Fail(pendingOperation.Error);
        var bindings = ports.Fleet.Bindings(current.Value.Fleet);
        if (!bindings.IsSuccess) return Result<FleetControlSnapshot>.Fail(bindings.Error);
        var agents = ports.Recipients(bindings.Value.Select(value => value.AgentId).ToArray());
        if (!agents.IsSuccess) return Result<FleetControlSnapshot>.Fail(agents.Error);
        var view = FleetValues.Control(current.Value.Fleet, current.Value.Connection, ports.Fleet.Authorization.Now());
        var agentIds = agents.Value.Where(value => value.Status == "active" && value.OwnerStatus == "active").Select(value => value.AgentId).Take(100).ToArray();
        FleetOperationView[] operations = pendingOperation.Value is null ? [] : [FleetValues.View(pendingOperation.Value)];
        var snapshot = new FleetControlSnapshot(view, agentIds, [], operations);
        if (!view.DeliveryEnabled) return Result<FleetControlSnapshot>.Success(snapshot);
        var pending = ports.Pending(fleetId, ports.Fleet.Authorization.Now());
        if (!pending.IsSuccess) return Result<FleetControlSnapshot>.Fail(pending.Error);
        if (pending.Value is null) return Result<FleetControlSnapshot>.Success(snapshot);
        var message = ports.Find(pending.Value);
        if (!message.IsSuccess) return Result<FleetControlSnapshot>.Fail(message.Error);
        if (message.Value is null) return Results.Fail<FleetControlSnapshot>("unavailable", "Fleet message is missing");
        var deliveries = ports.Deliveries([pending.Value]);
        if (!deliveries.IsSuccess) return Result<FleetControlSnapshot>.Fail(deliveries.Error);
        var sender = message.Value.AuthorPrincipalId is null ? Result<Principal?>.Success(null) : ports.Fleet.Authorization.Principal(message.Value.AuthorPrincipalId);
        if (!sender.IsSuccess) return Result<FleetControlSnapshot>.Fail(sender.Error);
        if (message.Value.AuthorPrincipalId is not null && sender.Value is null) return Results.Fail<FleetControlSnapshot>("unavailable", "Fleet message sender is missing");
        var command = new FleetMessageCommand(message.Value.Id, fleetId, message.Value.Body, message.Value.CreatedAt, message.Value.ExpiresAt,
            new(message.Value.AuthorPrincipalId is null ? "controller" : "human", sender.Value?.BackendUserId),
            deliveries.Value.Where(value => value.Status == "pending").Select(value => value.AgentId).ToArray());
        return Result<FleetControlSnapshot>.Success(snapshot with { Messages = [command] });
    }

    public static Result<bool> Receipt(FleetMessagePorts ports, FleetActor actor, string fleetId, string messageId, string agentId, string status, string? errorMessage)
    {
        if (actor is not FleetControllerActor) return Results.Fail<bool>("forbidden", "Only this fleet controller may report message receipts");
        if (status is not ("delivered" or "failed" or "skipped") || (status == "delivered") != (errorMessage is null))
            return Results.Fail<bool>("invalid", "Only failed/skipped deliveries have an error message");
        return ports.Fleet.Transaction.Run(() =>
        {
            var fleet = FleetAuthority.Find(ports.Fleet, actor, fleetId);
            if (!fleet.IsSuccess) return Result<bool>.Fail(fleet.Error);
            var message = ports.Find(messageId);
            if (!message.IsSuccess) return Result<bool>.Fail(message.Error);
            if (message.Value is null) return Result<bool>.Success(false);
            if (message.Value.FleetId != fleetId) return Results.Fail<bool>("missing", "Fleet message not found");
            var delivery = ports.Delivery(messageId, agentId);
            if (!delivery.IsSuccess) return Result<bool>.Fail(delivery.Error);
            if (delivery.Value is null) return Results.Fail<bool>("missing", "Fleet message recipient not found");
            if (delivery.Value.Status != "pending") return delivery.Value.Status == status && delivery.Value.ErrorMessage == errorMessage
                ? Result<bool>.Success(true) : Results.Fail<bool>("conflict", "This recipient already has a different final outcome");
            return ports.SaveDelivery(delivery.Value with { Status = status, ErrorMessage = errorMessage, CompletedAt = ports.Fleet.Authorization.Now() }).Map(_ => true);
        });
    }
}
