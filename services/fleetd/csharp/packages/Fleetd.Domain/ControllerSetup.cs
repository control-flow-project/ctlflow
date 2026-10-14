using Crossfire.Kernel;

namespace Fleetd.Domain;

public sealed partial class FleetController
{
    private readonly SemaphoreSlim setupGate = new(1, 1);
    public async ValueTask<Result<SetupOutcome>> Setup(SetupRequest input, CancellationToken cancellation)
    {
        await setupGate.WaitAsync(cancellation); try
        {
            if (stopping) return Results.Fail<SetupOutcome>("unavailable", "Controller is stopping"); var prepared = registry.Setup(input); if (!prepared.IsSuccess) return Result<SetupOutcome>.Fail(prepared.Error); var (configuration, operationId, completed) = prepared.Value;
            var inspected = await execution.Inspect(configuration, configuration.Roster.Instances, cancellation); if (!inspected.IsSuccess) return Result<SetupOutcome>.Fail(inspected.Error); FleetRegistration? record; lock (gate) record = records.FirstOrDefault(record => record.Directory == configuration.Directory);
            if (completed && record is null) return Results.Fail<SetupOutcome>("conflict", "Completed setup was unregistered; an archived identity cannot be recreated implicitly"); if (record is not null) await restoration;
            var current = record is null ? Add(configuration.Directory) : View(record.FleetId); if (!current.IsSuccess) return Result<SetupOutcome>.Fail(current.Error);
            async ValueTask<Result<SetupOutcome>> Existing()
            { var value = current.Value; var active = value.Instances.Any(instance => instance.DesiredActive); var ready = value.Connection.Connected && value.Instances.All(instance => !instance.DesiredActive || instance.SessionId is not null && instance.Phase is "running" or "sleeping"); if (active && ready) { var tested = await Test(value.Registration.FleetId, cancellation); if (!tested.IsSuccess) return Result<SetupOutcome>.Fail(tested.Error); } return Result<SetupOutcome>.Success(new(value, null, active ? ready ? "ready" : "starting" : "stopped")); }
            if (completed) return await Existing(); var history = registry.Operation(operationId); if (!history.IsSuccess) return Result<SetupOutcome>.Fail(history.Error); var operation = history.Value;
            var deliberatelyStopped = record is not null && current.Value.ResumeInstanceKeys is not null && current.Value.Instances.All(instance => !instance.DesiredActive); var restored = record is not null && operation?.Status == "failed" && current.Value.Instances.Count > 0 && current.Value.Instances.All(instance => instance.DesiredActive && instance.SessionId is not null && instance.Phase is "running" or "sleeping");
            if (deliberatelyStopped || restored) { var existing = await Existing(); if (!existing.IsSuccess) return existing; var marked = registry.CompleteSetup(operationId); return marked.IsSuccess ? existing : Result<SetupOutcome>.Fail(marked.Error); }
            var retry = operation?.Status == "failed" ? Crossfire.Kernel.Identity.Identifier() : operationId; if (retry != operationId) { var renewed = registry.RetrySetup(operationId, retry); if (!renewed.IsSuccess) return Result<SetupOutcome>.Fail(renewed.Error); }
            var accepted = operation is not null && operation.Status != "failed" ? Result<FleetOperation>.Success(operation) : await Operate(new(retry, new("fleet", current.Value.Registration.FleetId), "start", current.Value.Registration.Revision)); if (!accepted.IsSuccess) return Result<SetupOutcome>.Fail(accepted.Error);
            return Result<SetupOutcome>.Success(new(current.Value, accepted.Value, accepted.Value.Status == "succeeded" ? "ready" : "starting"));
        }
        finally { setupGate.Release(); }
    }
}
