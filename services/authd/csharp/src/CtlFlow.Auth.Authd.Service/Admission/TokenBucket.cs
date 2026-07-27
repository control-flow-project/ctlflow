namespace CtlFlow.Auth.Authd.Service.Admission;

internal sealed class TokenBucket(int capacity, double refillPerSecond)
{
    private readonly Lock _gate = new();
    private double _tokens = capacity;
    private long _lastTimestamp = System.Diagnostics.Stopwatch.GetTimestamp();

    internal bool TryAcquire()
    {
        lock (_gate)
        {
            var current = System.Diagnostics.Stopwatch.GetTimestamp();
            var elapsed = System.Diagnostics.Stopwatch.GetElapsedTime(
                _lastTimestamp,
                current).TotalSeconds;
            _lastTimestamp = current;
            _tokens = Math.Min(
                capacity,
                _tokens + elapsed * refillPerSecond);
            if (_tokens < 1)
            {
                return false;
            }

            _tokens -= 1;
            return true;
        }
    }
}
