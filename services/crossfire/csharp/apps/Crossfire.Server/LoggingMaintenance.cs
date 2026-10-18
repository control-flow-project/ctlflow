using Crossfire.AdapterSqlite;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public sealed record LoggingProgress(long NextAt, LoggingScan Scan);

public static class LoggingMaintenance
{
    public static LoggingProgress Run(ApiState state, LoggingProgress progress)
    {
        var now = state.Now(); if (now < progress.NextAt) return progress;
        using var context = state.Storage.Open();
        var cutoff = checked(now - state.Configuration.LoggingRetentionDays * 86400000);
        var result = LoggingRetention.Prune(context, cutoff, 500, progress.Scan); var files = state.Diagnostics.Prune();
        var error = !result.IsSuccess ? "Database logging cleanup remains pending: " + result.Error.Code : !files.IsSuccess ? files.Error.Message : null;
        state.Diagnostics.MaintenanceError(error);
        return new(now + (error is not null || result.IsSuccess && result.Value.More ? 5000 : 3600000), result.IsSuccess ? result.Value.Scan : progress.Scan);
    }
}
