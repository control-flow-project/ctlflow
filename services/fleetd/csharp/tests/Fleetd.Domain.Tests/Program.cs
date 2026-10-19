using System.Runtime.CompilerServices;
using Fleetd.Domain.Tests;

if (args.Length != 0) throw new ArgumentException("Controller ownership acceptance takes no suite flags");
var assertions = 0;
void Check(bool condition, string label) { if (!condition) throw new InvalidOperationException(label); assertions++; }
foreach (var individual in new[] { false, true })
{
    await using var fixture = new ControllerFixture(); await fixture.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
    var stopped = await fixture.Operate("stop", individual); Check(stopped.IsSuccess, "A stop request is admitted while restoration is starting");
    Check(fixture.Starting.IsCancellationRequested, "Stop cancels the exact in-progress native startup");
    Check(fixture.Controller.Operation(stopped.Value.Request.OperationId).Value.CompletedAt is null, "Stop cannot complete while a native startup is still unresolved");
    var diagnostic = await fixture.Controller.Diagnostics(new(ControllerFixture.FleetId, "analyst"), CancellationToken.None);
    Check(diagnostic.IsSuccess, "Read-only diagnostics remain available while startup shutdown is unresolved");
    Check(diagnostic.Value.Checks.Single(value => value.Id == "agent.activation").Message == "Agent is not selected for activation", "Diagnostics report activation intent separately");
    Check(diagnostic.Value.Checks.Single(value => value.Id == "agent.native").Message == "Native state: unknown", "Pending stop is not reported as completed native shutdown");
    Check(fixture.Starts == 1, "Diagnosis does not start another native owner");
    fixture.Release(); var completed = await fixture.Completion(stopped.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5)); await fixture.Controller.Ready.WaitAsync(TimeSpan.FromSeconds(5));
    Check(completed.Status == "succeeded", "Stop succeeds after the late native startup is disposed"); Check(fixture.First.Disposed, "A late native result cannot be installed after stop");
    var state = fixture.Controller.View(ControllerFixture.FleetId).Value;
    Check(state.Instances.Single().Phase == "stopped" && !state.Instances.Single().DesiredActive, "Stop state and saved intent agree");
    Check(fixture.Starts == 1, "Stopped startup is not retried");
    Check(fixture.Controller.Contexts(ControllerFixture.FleetId, "analyst").Value.Single().SessionId == ControllerFixture.SessionId, "Saved native identity remains available after stop");
    var resumed = await fixture.Operate("start", individual); Check(resumed.IsSuccess, "Explicit resume remains available after cancelling startup");
    var resumedOperation = await fixture.Completion(resumed.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5));
    Check(resumedOperation.Status == "succeeded", "Explicit resume completes"); Check(fixture.Starts == 2, "Explicit resume creates exactly one replacement native process");
    var active = fixture.Controller.View(ControllerFixture.FleetId).Value.Instances.Single(); Check(active.DesiredActive && active.SessionId == ControllerFixture.SessionId, "Resume retains the exact saved native history");
}
await using (var fixture = new ControllerFixture())
{
    await fixture.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); var shutdown = fixture.Controller.DisposeAsync().AsTask();
    Check(fixture.Starting.IsCancellationRequested, "Daemon shutdown cancels restoration"); Check(!shutdown.IsCompleted, "Daemon shutdown waits for unresolved startup ownership");
    fixture.Release(); await shutdown.WaitAsync(TimeSpan.FromSeconds(5)); Check(fixture.First.Disposed, "Daemon shutdown disposes a late native result"); Check(fixture.Starts == 1, "Shutdown never schedules replacement work");
}
await using (var fixture = new ControllerFixture())
{
    await fixture.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); fixture.Release(); await fixture.Controller.Ready.WaitAsync(TimeSpan.FromSeconds(5));
    Task<Crossfire.Kernel.Result<Fleetd.Domain.FleetOperation>>? next = null;
    fixture.Completed = _ => { fixture.Completed = null; next = fixture.Operate("start").AsTask(); };
    var stopped = await fixture.Operate("stop"); Check(stopped.IsSuccess, "Stop is admitted before checking completion publication");
    var completed = await fixture.Completion(stopped.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5));
    Check(completed.Status == "succeeded", "Stop publishes success after native cleanup");
    Check(next is not null, "A terminal operation is observed by its storage subscriber");
    var resumed = await next!; Check(resumed.IsSuccess, "Observing a terminal operation immediately permits the next operation");
    Check((await fixture.Completion(resumed.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5))).Status == "succeeded", "Completion of a predecessor cannot remove the replacement operation");
}
await using (var fixture = new ControllerFixture())
{
    await fixture.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); fixture.Release(); await fixture.Controller.Ready.WaitAsync(TimeSpan.FromSeconds(5));
    var stopped = await fixture.Operate("stop"); await fixture.Completion(stopped.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5));
    fixture.StartFailure = new ArgumentException("Native adapter rejected startup");
    var started = await fixture.Operate("start"); Check(started.IsSuccess, "A native startup failure is recorded by its admitted operation");
    var failed = await fixture.Completion(started.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5));
    Check(failed.Status == "failed" && failed.Errors.Single().Message == "Native adapter rejected startup", "An unexpected adapter exception publishes the explicit failure after cleanup");
    fixture.StartFailure = null; var stop = await fixture.Operate("stop"); Check(stop.IsSuccess, "A failed native adapter cannot strand the operation slot");
    Check((await fixture.Completion(stop.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5))).Status == "succeeded", "Explicit stop remains available after adapter failure");
    var resumed = await fixture.Operate("start"); Check(resumed.IsSuccess, "Startup can be retried after the native adapter failure is corrected");
    Check((await fixture.Completion(resumed.Value.Request.OperationId).WaitAsync(TimeSpan.FromSeconds(5))).Status == "succeeded", "The replacement owner completes normally");
}
await NativeWorkAcceptance.Run(Check);
Console.WriteLine("{\"status\":\"passed\",\"scope\":\"controller state transitions\",\"assertions\":" + assertions + ",\"dynamicCode\":" + (RuntimeFeature.IsDynamicCodeSupported ? "true" : "false") + "}");
