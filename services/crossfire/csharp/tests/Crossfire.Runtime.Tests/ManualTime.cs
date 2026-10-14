namespace Crossfire.Runtime.Tests;

public sealed class ManualTime : TimeProvider
{
    private readonly object gate = new();
    private readonly HashSet<ClockTimer> timers = [];
    private long ticks;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() { lock (gate) return ticks; }
    public override DateTimeOffset GetUtcNow() => DateTimeOffset.UnixEpoch.AddTicks(GetTimestamp());
    public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
    {
        var timer = new ClockTimer(this, callback, state); timer.Change(dueTime, period); return timer;
    }
    public void Advance(TimeSpan elapsed)
    {
        if (elapsed < TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(elapsed));
        ClockTimer[] ready;
        lock (gate) { ticks += elapsed.Ticks; ready = timers.Where(timer => timer.Due <= ticks).ToArray(); foreach (var timer in ready) timer.Due = timer.Period == Timeout.InfiniteTimeSpan ? long.MaxValue : checked(ticks + timer.Period.Ticks); }
        foreach (var timer in ready) timer.Invoke();
    }
    private sealed class ClockTimer(ManualTime clock, TimerCallback callback, object? state) : ITimer
    {
        private bool disposed;
        public long Due { get; set; }
        public TimeSpan Period { get; private set; }
        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            lock (clock.gate)
            {
                if (disposed) return false;
                Period = period; Due = dueTime == Timeout.InfiniteTimeSpan ? long.MaxValue : checked(clock.ticks + dueTime.Ticks); clock.timers.Add(this); return true;
            }
        }
        public void Invoke() { lock (clock.gate) { if (disposed) return; } callback(state); }
        public void Dispose() { lock (clock.gate) { disposed = true; clock.timers.Remove(this); } }
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }
}
