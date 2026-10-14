using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public sealed class FleetChanges(TimeProvider? provider = null)
{
    private readonly Dictionary<string, long> versions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, TaskCompletionSource> waiting = new(StringComparer.Ordinal);
    private readonly object gate = new();
    private readonly TimeProvider time = provider ?? TimeProvider.System;

    public long Version(string fleetId) { lock (gate) return versions.GetValueOrDefault(fleetId); }

    public void Notify(string? fleetId = null)
    {
        lock (gate)
        {
            var keys = fleetId is null ? waiting.Keys.ToArray() : [fleetId];
            foreach (var key in keys) { versions[key] = versions.GetValueOrDefault(key) + 1; if (waiting.TryGetValue(key, out var source)) source.TrySetResult(); }
            if (versions.Count > 2048)
                foreach (var key in versions.Keys.Where(key => !waiting.ContainsKey(key)).Take(versions.Count - 1024).ToArray()) versions.Remove(key);
        }
    }

    public async ValueTask<Result<Unit>> Wait(string fleetId, long previous, int milliseconds, CancellationToken cancellation)
    {
        if (cancellation.IsCancellationRequested) return Results.Fail<Unit>("unavailable", "Controller request closed");
        TaskCompletionSource source;
        lock (gate)
        {
            if (versions.GetValueOrDefault(fleetId) != previous || milliseconds == 0) return Results.Done();
            if (waiting.ContainsKey(fleetId)) return Results.Fail<Unit>("conflict", "This fleet already has a pending controller long poll");
            source = new(TaskCreationOptions.RunContinuationsAsynchronously); waiting.Add(fleetId, source);
        }
        try { await source.Task.WaitAsync(TimeSpan.FromMilliseconds(milliseconds), time, cancellation); return Results.Done(); }
        catch (TimeoutException) { return Results.Done(); }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { return Results.Fail<Unit>("unavailable", "Controller request closed"); }
        finally { lock (gate) waiting.Remove(fleetId); }
    }
}
