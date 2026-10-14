using System.Text;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterProcess;
using Crossfire.Kernel;

namespace Fleetd.AdapterExecution;

public static class ProjectFiles
{
    public static async ValueTask<Result<Unit>> Protect(string directory, IReadOnlyList<string> paths, CancellationToken cancellation)
    {
        ValueTask<Result<CommandOutput>> Git(params string[] arguments) => NativeProcess.Capture(new("git", ["-C", directory, ..arguments], directory, new Dictionary<string, string?>()), 1048576, 10000, cancellation);
        var repository = await Git("rev-parse", "--is-inside-work-tree"); if (!repository.IsSuccess) return Result<Unit>.Fail(repository.Error); if (repository.Value.ExitCode == 128) return Results.Done(); if (repository.Value.ExitCode != 0) return Results.Fail<Unit>("unavailable", "Git is required to verify project credential privacy");
        var missing = new List<string>(); foreach (var path in paths)
        {
            var pattern = path == "**/workarea/" ? ":(glob)**/workarea/**" : path; var tracked = await Git("ls-files", "--", pattern); if (!tracked.IsSuccess) return Result<Unit>.Fail(tracked.Error); if (tracked.Value.ExitCode != 0) return Results.Fail<Unit>("unavailable", "Cannot inspect tracked private project files"); if (!string.IsNullOrWhiteSpace(tracked.Value.Output)) return Results.Fail<Unit>("forbidden", "Private fleet integration files are tracked by Git; remove them from tracking before starting: " + path);
            var probe = path == "**/workarea/" ? "agents/privacy-check/workarea/check/check.json" : path.EndsWith('/') ? path + "check.json" : path; var ignored = await Git("check-ignore", "--quiet", "--", probe); if (!ignored.IsSuccess) return Result<Unit>.Fail(ignored.Error); if (ignored.Value.ExitCode == 1) missing.Add(path); else if (ignored.Value.ExitCode != 0) return Results.Fail<Unit>("unavailable", "Cannot verify Git exclusions for this project");
        }
        if (missing.Count != 0) { var ignore = Path.Combine(directory, ".gitignore"); var original = PrivateFiles.Exists(ignore) ? PrivateFiles.ReadConfiguration(ignore, 1048576) : []; var addition = Encoding.UTF8.GetBytes("\n" + string.Join('\n', missing) + "\n"); if (original.Length + addition.Length > 1048576) return Results.Fail<Unit>("limit", "Project ignore file exceeds its finite bound"); PrivateFiles.WriteConfiguration(ignore, [..original, ..addition], 1048576); }
        return Results.Done();
    }
}
