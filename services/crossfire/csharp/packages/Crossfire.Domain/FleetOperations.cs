using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class FleetOperations
{
    public static Result<FleetOperationView> Request(FleetPorts ports, FleetActor actor, string fleetId, FleetOperationRequest input, string requestId)
    {
        if (actor is not FleetPrincipalActor { Identity.Kind: "human" } principal)
            return Results.Fail<FleetOperationView>("forbidden", "Only the fleet owner or an administrator may request session operations");
        if (input.Action is not ("start" or "stop" or "reset") || input.ConfirmFreshHistory != (input.Action == "reset"))
            return Results.Fail<FleetOperationView>("invalid", "Fresh history requires explicit confirmation");
        return ports.Transaction.Run(() =>
        {
            var fleet = FleetAuthority.Find(ports, actor, fleetId, true);
            if (!fleet.IsSuccess) return Result<FleetOperationView>.Fail(fleet.Error);
            var previous = ports.Operation(input.OperationId);
            if (!previous.IsSuccess) return Result<FleetOperationView>.Fail(previous.Error);
            if (previous.Value is not null)
                return previous.Value.FleetId == fleetId && previous.Value.AuthorPrincipalId == principal.Identity.PrincipalId && previous.Value.AgentId == input.AgentId
                    && previous.Value.Action == input.Action && previous.Value.ExpectedRevision == input.ExpectedRevision
                    ? Result<FleetOperationView>.Success(FleetValues.View(previous.Value)) : Results.Fail<FleetOperationView>("conflict", "Operation ID belongs to a different session request");
            if (fleet.Value.Revision != input.ExpectedRevision) return Results.Fail<FleetOperationView>("stale_revision", "Refresh the fleet before changing sessions");
            var connection = ports.Connection(fleetId);
            if (!connection.IsSuccess) return Result<FleetOperationView>.Fail(connection.Error);
            if (FleetValues.Connection(connection.Value, ports.Authorization.Now()).Status != "online")
                return Results.Fail<FleetOperationView>("conflict", "Connect the fleet controller before changing sessions");
            var instances = ports.Bindings(fleet.Value);
            if (!instances.IsSuccess) return Result<FleetOperationView>.Fail(instances.Error);
            if (instances.Value.Count == 0 || input.AgentId is not null && !instances.Value.Any(instance => instance.AgentId == input.AgentId))
                return Results.Fail<FleetOperationView>("missing", "The target is not an enrolled agent in this fleet");
            var pending = ports.PendingOperation(fleetId);
            if (!pending.IsSuccess) return Result<FleetOperationView>.Fail(pending.Error);
            if (pending.Value is not null) return Results.Fail<FleetOperationView>("conflict", "A session operation is already pending for this fleet");
            var now = ports.Authorization.Now();
            var operation = new FleetOperation(input.OperationId, fleetId, input.AgentId, input.Action, input.ExpectedRevision,
                principal.Identity.PrincipalId, "pending", now, null, null, null, null);
            var stored = ports.InsertOperation(operation);
            if (!stored.IsSuccess) return Result<FleetOperationView>.Fail(stored.Error);
            var updated = ports.Save(fleet.Value with { Revision = checked(fleet.Value.Revision + 1), UpdatedAt = now });
            if (!updated.IsSuccess) return Result<FleetOperationView>.Fail(updated.Error);
            return ports.Audit(FleetValues.Audit(actor, requestId, fleet.Value, "fleet.session." + input.Action, input.OperationId)).Map(_ => FleetValues.View(operation));
        });
    }

    public static Result<Page<FleetOperationView>> List(FleetPorts ports, FleetActor actor, string fleetId, int page, int pageSize)
    {
        var fleet = FleetAuthority.Find(ports, actor, fleetId);
        if (!fleet.IsSuccess) return Result<Page<FleetOperationView>>.Fail(fleet.Error);
        return ports.Operations(fleetId, page, pageSize).Map(records => new Page<FleetOperationView>(records.Items.Select(FleetValues.View).ToArray(), records.PageNumber, records.PageSize, records.TotalItems));
    }

    public static Result<FleetOperationView> Claim(FleetPorts ports, FleetActor actor, string fleetId, string operationId, string connectionId)
        => ports.Transaction.Run(() =>
        {
            var current = FleetAuthority.Live(ports, actor, fleetId, connectionId);
            if (!current.IsSuccess) return Result<FleetOperationView>.Fail(current.Error);
            var found = ports.Operation(operationId);
            if (!found.IsSuccess) return Result<FleetOperationView>.Fail(found.Error);
            if (found.Value is null || found.Value.FleetId != fleetId) return Results.Fail<FleetOperationView>("missing", "Session operation not found");
            var operation = found.Value;
            if (operation.Status is "succeeded" or "failed") return Result<FleetOperationView>.Success(FleetValues.View(operation));
            var allowed = FleetAuthority.Requester(ports, operation.AuthorPrincipalId, current.Value.Fleet);
            if (!allowed.IsSuccess) return Result<FleetOperationView>.Fail(allowed.Error);
            var instances = ports.Bindings(current.Value.Fleet);
            if (!instances.IsSuccess) return Result<FleetOperationView>.Fail(instances.Error);
            var valid = allowed.Value && (operation.Status != "pending" || current.Value.Fleet.Revision == checked(operation.ExpectedRevision + 1))
                && (operation.AgentId is null || instances.Value.Any(instance => instance.AgentId == operation.AgentId));
            var next = valid ? operation with { Status = "running", ConnectionId = connectionId, CredentialId = current.Value.Connection.CredentialId }
                : operation with { Status = "failed", CompletedAt = ports.Authorization.Now(), ErrorMessage = operation.Status == "pending"
                    ? "Session request authority or roster changed before execution"
                    : "Session request authority or roster changed after execution was claimed; inspect the controller’s native operation outcome" };
            return ports.SaveOperation(next).Map(_ => FleetValues.View(next));
        });

    public static Result<bool> Receipt(FleetPorts ports, FleetActor actor, string fleetId, string operationId, FleetOperationReceipt input)
    {
        if (input.Status is not ("succeeded" or "failed") || (input.Status == "failed") != (input.ErrorMessage is not null))
            return Results.Fail<bool>("invalid", "Invalid session receipt");
        return ports.Transaction.Run(() =>
        {
            var current = FleetAuthority.Live(ports, actor, fleetId, input.ConnectionId);
            if (!current.IsSuccess) return Result<bool>.Fail(current.Error);
            var found = ports.Operation(operationId);
            if (!found.IsSuccess) return Result<bool>.Fail(found.Error);
            if (found.Value is null) return Result<bool>.Success(false);
            if (found.Value.FleetId != fleetId) return Results.Fail<bool>("missing", "Session operation not found");
            if (found.Value.Status is "succeeded" or "failed")
                return found.Value.Status == input.Status && found.Value.ErrorMessage == input.ErrorMessage ? Result<bool>.Success(true)
                    : Results.Fail<bool>("conflict", "This session operation already has a different final outcome");
            if (found.Value.Status != "running" || found.Value.ConnectionId != input.ConnectionId || found.Value.CredentialId != current.Value.Connection.CredentialId)
                return Results.Fail<bool>("conflict", "Claim this operation on the current controller connection before reporting its outcome");
            return ports.SaveOperation(found.Value with { Status = input.Status, ErrorMessage = input.ErrorMessage, CompletedAt = ports.Authorization.Now() }).Map(_ => true);
        });
    }
}
