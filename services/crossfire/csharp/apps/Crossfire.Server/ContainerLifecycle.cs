using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.Server;

public static class ContainerLifecycle
{
    public static async Task Owned(IReadOnlyList<string> arguments, string workspace, CancellationToken cancellation)
    {
        if (arguments.Count < 2 || arguments[0] != "run" || !arguments.Contains("--name") || arguments.Any(value => value == "--rm" || value.StartsWith("--rm=", StringComparison.Ordinal))) throw new ArgumentException("Use the explicit owned runtime container command without automatic removal"); cancellation.ThrowIfCancellationRequested();
        var created = await ContainerCommands.Capture(["create", .. arguments.Skip(1)], workspace, CancellationToken.None); if (created.ExitCode != 0) throw new IOException("Cannot create the owned runtime container: " + created.Errors);
        var identity = created.Output.Trim(); if (identity.Length != 64 || identity.Any(character => !char.IsAsciiHexDigitLower(character))) throw new IOException("Docker did not return an exact container identity");
        using var attach = new CancellationTokenSource(); Task? running = null; Exception? failure = null;
        try
        {
            cancellation.ThrowIfCancellationRequested(); running = ContainerCommands.Run(["start", "--attach", identity], workspace, attach.Token); var cancelled = Task.Delay(Timeout.InfiniteTimeSpan, cancellation);
            if (await Task.WhenAny(running, cancelled) == cancelled)
            {
                using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                try { await ContainerCommands.Run(["stop", "--timeout", "15", identity], workspace, stop.Token); }
                finally { await attach.CancelAsync(); }
            }
            await running;
        }
        catch (Exception error) { failure = error; }
        finally
        {
            await attach.CancelAsync(); if (running is not null) try { await running; } catch (Exception error) { failure ??= error; }
            try { await Remove(identity, workspace, CancellationToken.None); }
            catch (Exception error) { failure = new IOException("Owned runtime container cleanup is not confirmed", failure ?? error); }
        }
        if (failure is not null && !(cancellation.IsCancellationRequested && failure is OperationCanceledException)) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }
    public static (string Runtime, string Migration) Names(string directory)
    {
        var digest = Identity.Hash(directory)[..16];
        return ("crossfire-" + digest, "crossfire-migration-" + digest);
    }
    private static async Task<string[]> Identities(string filter, string workspace, CancellationToken cancellation)
    {
        var result = await ContainerCommands.Capture(["container", "ls", "--all", "--no-trunc", "--filter", filter, "--format", "{{.ID}}"], workspace, cancellation);
        if (result.ExitCode != 0) throw new IOException("Cannot establish existing container ownership: " + result.Errors);
        var identities = result.Output.Trim().Length == 0 ? [] : result.Output.Trim().Split('\n');
        if (identities.Any(identity => identity.Length != 64 || identity.Any(character => !char.IsAsciiHexDigitLower(character)))) throw new IOException("Docker returned an invalid container identity");
        return identities;
    }
    public static async Task Remove(string identity, string workspace, CancellationToken cancellation)
    {
        if (identity.Length != 64 || identity.Any(character => !char.IsAsciiHexDigitLower(character))) throw new ArgumentException("Cleanup requires an exact container identity");
        var stopped = await ContainerCommands.Capture(["stop", "--timeout", "15", identity], workspace, cancellation);
        if (stopped.ExitCode != 0 && (await Identities("id=" + identity, workspace, cancellation)).Length != 0) throw new IOException("Owned container stop is not confirmed: " + stopped.Errors);
        var removed = await ContainerCommands.Capture(["rm", identity], workspace, cancellation);
        if ((await Identities("id=" + identity, workspace, cancellation)).Length != 0) throw new IOException("Owned container cleanup is not confirmed: " + removed.Errors);
    }
    public static async Task Reconcile(string directory, string workspace, CancellationToken cancellation)
    {
        var owned = new List<string>(); var names = Names(directory);
        foreach (var name in new[] { names.Runtime, names.Migration })
        {
            var identities = await Identities("name=^/" + name + "$", workspace, cancellation);
            if (identities.Length > 1) throw new IOException("Docker returned ambiguous instance container ownership");
            foreach (var identity in identities)
            {
                var inspection = await ContainerCommands.Capture(["container", "inspect", "--format", "{{.Id}}\n{{json .Config.Labels}}", identity], workspace, cancellation);
                if (inspection.ExitCode != 0) throw new IOException("Cannot verify existing container ownership: " + inspection.Errors);
                var lines = inspection.Output.Trim().Split('\n');
                var labels = WireJson.Parse(System.Text.Encoding.UTF8.GetBytes(lines.Length == 2 ? lines[1] : "null"));
                if (lines[0] != identity || labels.ValueKind != JsonValueKind.Object || !labels.TryGetProperty("org.crossfire.directory", out var label) || label.ValueKind != JsonValueKind.String || label.GetString() != directory) throw new IOException("Existing container has different ownership; nothing was stopped");
                owned.Add(identity);
            }
        }
        foreach (var identity in owned) await Remove(identity, workspace, cancellation);
    }
}
