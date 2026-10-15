using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ListenerReportingAcceptance
{
    private static TaskCompletionSource Barrier() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    private static readonly JsonElement Accepted = WireJson.Object(writer =>
    { writer.WriteBoolean("statisticsAccepted", true); writer.WriteBoolean("disconnect", false); writer.WriteString("currentRelease", "0.1.20-000000000000000000000000"); });
    public static async Task Verify()
    {
        var clock = new ManualTime(); using var lifetime = new CancellationTokenSource(); var disconnected = 0; var started = 0; var stopped = 0; var calls = 0;
        var entered = Barrier(); var closing = Barrier(); var release = Barrier(); var holdClose = false;
        using var control = new ListenerControl(() => new("fleet", "same-connection", "same-credential"), (_, _, _, _) => ValueTask.FromResult(Results.Done()), _ => disconnected++);
        var coordination = new Coordination("https://fixture.invalid", async (request, cancellation) =>
        {
            Equal(request.Operation, "reportListener", "listener reporting uses its canonical coordination operation");
            if (request.Body!.Value.GetProperty("stopped").GetBoolean())
            { stopped++; if (holdClose) { closing.TrySetResult(); await release.Task.WaitAsync(cancellation); } }
            else if (++calls == 1)
            { entered.TrySetResult(); try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellation); } catch (OperationCanceledException) { } return Results.Fail<JsonElement>("unavailable", "HTTP request cancelled by delivery pause"); }
            return Result<JsonElement>.Success(Accepted);
        });
        var reporting = new ListenerReporting(new(coordination, "agent", "0.1.20-000000000000000000000000", control, new("@agent:fixture", clock), clock,
            _ => { }, _ => { }, (_, binding) => { Equal(binding.ConnectionId, "same-connection", "delivery pause retains controller authority"); started++; }, error => throw new InvalidOperationException(error.Message)), lifetime.Token);
        try
        {
            Equal((await reporting.Activate()).Value, false, "inactive listener performs no registration"); Equal(calls, 0, "inactive reporting makes no request");
            control.Update(true, null); var pending = reporting.Activate().AsTask(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); control.Update(false, null);
            Equal((await pending.WaitAsync(TimeSpan.FromSeconds(5))).Value, false, "pause cancels in-flight registration without claiming activation");
            Equal(disconnected, 0, "expected delivery cancellation never invalidates the fleet connection"); Equal(started, 0, "cancelled registration is not reported as a listener run");
            control.Update(true, null); Equal((await reporting.Activate()).Value, true, "delivery resumes with the same controller binding"); var first = reporting.RunId;
            Equal(first is not null, true, "successful registration supplies a run identity"); Equal((await reporting.Activate()).Value, true, "current activity is reused"); Equal(calls, 2, "reuse does not register twice");
            holdClose = true; control.Update(false, null); control.Update(true, null); var replacing = reporting.Activate().AsTask(); await closing.Task.WaitAsync(TimeSpan.FromSeconds(5));
            control.Update(false, null); control.Update(true, null); release.TrySetResult();
            Equal((await replacing.WaitAsync(TimeSpan.FromSeconds(5))).Value, false, "a generation cancelled during old-run cleanup is not activated"); Equal(calls, 2, "stale activation cannot register a replacement");
            Equal((await reporting.Activate()).Value, true, "next activation registers the current generation"); Equal(reporting.RunId != first, true, "new reporting generation has its own authenticated run");
            Equal(started, 2, "only successful runs report activity"); Equal(disconnected, 0, "rapid pause and resume do not reconnect the fleet");
            await reporting.Pause(); Equal(stopped, 2, "both acquired reporters close exactly once"); Equal(reporting.RunId is null, true, "closed reporter has no live identity");
        }
        finally { release.TrySetResult(); await reporting.Pause(); }
        using var failedControl = new ListenerControl(() => new("fleet", "connection", "credential"), (_, _, _, _) => ValueTask.FromResult(Results.Done()), _ => disconnected++);
        failedControl.Update(true, null);
        var unavailable = new Coordination("https://fixture.invalid", (_, _) => ValueTask.FromResult(Results.Fail<JsonElement>("unavailable", "Actual unavailable coordination")));
        var failed = new ListenerReporting(new(unavailable, "agent", "release", failedControl, new("@agent:fixture", clock), clock, _ => { }, _ => { }, (_, _) => { }, _ => { }), lifetime.Token);
        Equal((await failed.Activate()).Value, false, "actual transport failure refuses activation"); Equal(disconnected, 1, "uncancelled transport failure still disconnects the controller"); await failed.Pause();
    }
}
