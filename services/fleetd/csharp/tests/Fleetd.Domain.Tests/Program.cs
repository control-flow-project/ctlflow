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
await NativeWorkAcceptance.Run(Check);
Console.WriteLine("{\"status\":\"passed\",\"scope\":\"controller state transitions\",\"assertions\":" + assertions + ",\"dynamicCode\":" + (RuntimeFeature.IsDynamicCodeSupported ? "true" : "false") + "}");
