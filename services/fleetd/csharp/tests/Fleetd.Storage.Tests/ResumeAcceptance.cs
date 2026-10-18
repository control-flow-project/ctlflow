using Crossfire.Kernel;
using Fleetd.Domain;
using Fleetd.Storage;

namespace Fleetd.Storage.Tests;

public static class ResumeAcceptance
{
    public static void Run(string directory, Action<bool, string> check)
    {
        if (OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Private Unix fleetd storage acceptance requires Linux or macOS");
        var root = Path.Combine(directory, "resume"); var file = Path.Combine(root, "resume-work.json");
        var store = new ResumeFiles(root, TimeProvider.System).Port;
        check(store.Read().Value.Count == 0, "New checkpoint store is empty");
        InterruptedContext[] contexts = [new("shared", Identity.Identifier()), new("!room:fixture", Identity.Identifier())];
        check(store.Capture(contexts).IsSuccess, "Exact saved contexts are checkpointed");
        var before = store.Read().Value; var bytes = File.ReadAllBytes(file); var modified = File.GetLastWriteTimeUtc(file);
        check(store.Capture(contexts).IsSuccess && File.ReadAllBytes(file).AsSpan().SequenceEqual(bytes) && File.GetLastWriteTimeUtc(file) == modified,
            "Repeated activity does not rewrite unchanged checkpoints");
        check(!store.Capture([new("shared", Identity.Identifier())]).IsSuccess && File.ReadAllBytes(file).AsSpan().SequenceEqual(bytes), "Another native history cannot replace a checkpoint");
        check(!store.Renew(Identity.Identifier()).IsSuccess && File.ReadAllBytes(file).AsSpan().SequenceEqual(bytes), "Renewal rejects a changed identity without writes");
        check(store.Renew(before[0].MessageId).IsSuccess, "Restart identity is renewed atomically");
        var renewed = new ResumeFiles(root, TimeProvider.System).Port.Read().Value;
        check(renewed[0].SessionId == before[0].SessionId && renewed[0].Context == before[0].Context && renewed[0].MessageId != before[0].MessageId,
            "Reopened checkpoint retains its exact history with a new reminder identity");
        check(renewed[1] == before[1], "Renewal does not alter another room checkpoint");
        check(File.GetUnixFileMode(file) == (UnixFileMode.UserRead | UnixFileMode.UserWrite), "Checkpoint bytes remain private");
        bytes = File.ReadAllBytes(file);
        check(!store.Clear([contexts[1] with { SessionId = Identity.Identifier() }]).IsSuccess && File.ReadAllBytes(file).AsSpan().SequenceEqual(bytes), "Completion rejects another native history without writes");
        check(!store.Clear([contexts[1], contexts[1]]).IsSuccess && File.ReadAllBytes(file).AsSpan().SequenceEqual(bytes), "Completion rejects duplicate context claims without writes");
        check(store.Clear([contexts[1]]).IsSuccess && store.Read().Value.Count == 1 && store.Read().Value[0].Context == contexts[0].Context, "Clearing one completed room retains the other exact native task");
        check(store.Clear(contexts).IsSuccess && store.Read().Value.Count == 0, "Verified idle clears all completed contexts atomically");
        modified = File.GetLastWriteTimeUtc(file);
        check(store.Clear(contexts).IsSuccess && File.GetLastWriteTimeUtc(file) == modified, "Idle verification does not rewrite an already empty store");
    }
}
