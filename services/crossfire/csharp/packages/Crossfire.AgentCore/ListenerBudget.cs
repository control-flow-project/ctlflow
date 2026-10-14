using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public enum ListenerWork { Acquisition, Publication, NativeStart }
public sealed class ListenerBudget : IDisposable
{
    private sealed class Lane(int maximum) { public readonly SemaphoreSlim Slots = new(maximum, maximum); public int Queued; }
    private sealed class Lease(SemaphoreSlim slots) : IDisposable { private int released; public void Dispose() { if (Interlocked.Exchange(ref released, 1) == 0) slots.Release(); } }
    private readonly Lane acquisition = new(16), publication = new(8), native = new(4);
    public async ValueTask<Result<IDisposable>> Acquire(ListenerWork kind, CancellationToken cancellation, bool immediate = false)
    {
        var lane = kind switch { ListenerWork.Acquisition => acquisition, ListenerWork.Publication => publication, ListenerWork.NativeStart => native, _ => throw new ArgumentOutOfRangeException(nameof(kind)) };
        cancellation.ThrowIfCancellationRequested();
        if (immediate) return lane.Slots.Wait(0) ? Result<IDisposable>.Success(new Lease(lane.Slots)) : Results.Fail<IDisposable>("unavailable", "Immediate " + kind + " admission is unavailable; input has not been accepted");
        if (Interlocked.Increment(ref lane.Queued) > 10000) { Interlocked.Decrement(ref lane.Queued); return Results.Fail<IDisposable>("limit", "Listener host work queue capacity reached"); }
        try { await lane.Slots.WaitAsync(cancellation); return Result<IDisposable>.Success(new Lease(lane.Slots)); } finally { Interlocked.Decrement(ref lane.Queued); }
    }
    public void Dispose() { acquisition.Slots.Dispose(); publication.Slots.Dispose(); native.Slots.Dispose(); }
}

public sealed class ListenerSignal : IDisposable
{
    private readonly SemaphoreSlim signal = new(0, 1);
    private readonly object gate = new();
    private bool closed;
    public void Wake() { lock (gate) { if (closed) return; try { signal.Release(); } catch (SemaphoreFullException) { } } }
    public async ValueTask Wait(TimeSpan interval, TimeProvider clock, CancellationToken cancellation)
    {
        using var deadline = new CancellationTokenSource(interval, clock); using var scope = CancellationTokenSource.CreateLinkedTokenSource(cancellation, deadline.Token); Task waiting;
        lock (gate) { ObjectDisposedException.ThrowIf(closed, this); waiting = signal.WaitAsync(scope.Token); }
        try { await waiting; } catch (OperationCanceledException) when (deadline.IsCancellationRequested && !cancellation.IsCancellationRequested) { }
    }
    public void Dispose() { lock (gate) { if (closed) return; closed = true; signal.Dispose(); } }
}
