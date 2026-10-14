using Crossfire.AgentCore;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class SignalAcceptance
{
    public static async Task Verify()
    {
        var clock = new ManualTime(); using var signal = new ListenerSignal(); using var stop = new CancellationTokenSource();
        var notified = signal.Wait(TimeSpan.FromSeconds(10), clock, stop.Token).AsTask(); Equal(notified.IsCompleted, false, "listener notification waits for an observation");
        signal.Wake(); await notified.WaitAsync(TimeSpan.FromSeconds(5)); Equal(notified.IsCompletedSuccessfully, true, "listener notification completes on wake");
        var expired = signal.Wait(TimeSpan.FromSeconds(10), clock, stop.Token).AsTask(); clock.Advance(TimeSpan.FromSeconds(10)); await expired.WaitAsync(TimeSpan.FromSeconds(5));
        Equal(expired.IsCompletedSuccessfully, true, "controlled-clock deadline performs a bounded observation cycle");
        var cancelled = signal.Wait(TimeSpan.FromSeconds(10), clock, stop.Token).AsTask(); await stop.CancelAsync();
        try { await cancelled.WaitAsync(TimeSpan.FromSeconds(5)); throw new InvalidOperationException("Caller cancellation was swallowed"); } catch (OperationCanceledException) { Equal(cancelled.IsCanceled, true, "caller cancellation remains distinct from an observation deadline"); }
        signal.Dispose(); signal.Wake(); signal.Dispose(); var retired = signal.Wait(TimeSpan.FromSeconds(10), clock, CancellationToken.None).AsTask();
        try { await retired.WaitAsync(TimeSpan.FromSeconds(5)); throw new InvalidOperationException("A disposed listener signal admitted new work"); } catch (ObjectDisposedException) { Equal(retired.IsFaulted, true, "retired signals reject waits while late notification and repeated disposal stay harmless"); }
    }
}
