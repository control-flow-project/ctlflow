using Crossfire.Domain;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;
using Fleetd.Domain;

namespace Fleetd.Storage;

public sealed class ResumeFiles
{
    private readonly string file;
    private readonly TimeProvider clock;
    private readonly object gate = new();
    public ResumeWorkStore Port { get; }
    public ResumeFiles(string state, TimeProvider clock) { this.clock = clock; file = Path.Combine(PrivateFiles.Directory(state), "resume-work.json"); Port = new(Read, Capture, Renew, Clear); }
    private Result<IReadOnlyList<ResumeWork>> Read() => ConfigurationFiles.Boundary(() =>
    {
        lock (gate)
        {
            if (!PrivateFiles.Exists(file)) return Result<IReadOnlyList<ResumeWork>>.Success([]); var parsed = Validation.List(WireJson.Parse(PrivateFiles.Read(file, 2097152)), value =>
            {
                if (!Validation.Fields(value, ["context", "sessionId", "messageId", "checkpointedAt"]).IsSuccess) return Results.Fail<ResumeWork>("invalid", "Invalid interrupted-work checkpoint");
                var context = Validation.Text(value.GetProperty("context"), HistoryContext.MaximumLength); var session = Validation.Text(value.GetProperty("sessionId"), 200); var id = WireJson.Text(value, "messageId"); var at = Validation.Integer(value.GetProperty("checkpointedAt"), 0, 8640000000000000);
                return context.IsSuccess && session.IsSuccess && id is not null && Validation.Identifier(id) && at.IsSuccess ? Result<ResumeWork>.Success(new(context.Value, session.Value, id, at.Value)) : Results.Fail<ResumeWork>("invalid", "Invalid interrupted-work evidence");
            }, 2002); return parsed.IsSuccess && (parsed.Value.Select(value => value.Context).Distinct().Count() != parsed.Value.Count || parsed.Value.Select(value => value.MessageId).Distinct().Count() != parsed.Value.Count) ? Results.Fail<IReadOnlyList<ResumeWork>>("invalid", "Duplicate interrupted native history") : parsed;
        }
    });
    private Result<Unit> Save(IReadOnlyList<ResumeWork> values) => ConfigurationFiles.Boundary(() =>
    { PrivateFiles.Write(file, WireJson.Bytes(WireJson.Array(writer => { foreach (var value in values) { writer.WriteStartObject(); writer.WriteString("context", value.Context); writer.WriteString("sessionId", value.SessionId); writer.WriteString("messageId", value.MessageId); writer.WriteNumber("checkpointedAt", value.CheckpointedAt); writer.WriteEndObject(); } }), true), 2097152); return Results.Done(); });
    private Result<Unit> Capture(IReadOnlyList<InterruptedContext> contexts)
    {
        lock (gate)
        {
            if (contexts.Count > 2002 || contexts.Select(value => value.Context).Distinct().Count() != contexts.Count) return Results.Fail<Unit>("invalid", "Duplicate or excessive interrupted native histories");
            var read = Read(); if (!read.IsSuccess) return Result<Unit>.Fail(read.Error); var next = read.Value.ToDictionary(value => value.Context, StringComparer.Ordinal); var changed = false;
            foreach (var context in contexts) { if (next.TryGetValue(context.Context, out var value)) { if (value.SessionId != context.SessionId) return Results.Fail<Unit>("conflict", "Interrupted work belongs to another saved native history"); } else { if (next.Count >= 2002) return Results.Fail<Unit>("limit", "Interrupted-work context capacity reached"); next.Add(context.Context, new(context.Context, context.SessionId, Identity.Identifier(), clock.GetUtcNow().ToUnixTimeMilliseconds())); changed = true; } }
            return changed ? Save(next.Values.ToArray()) : Results.Done();
        }
    }
    private Result<ResumeWork> Renew(string id)
    {
        lock (gate)
        {
            var read = Read(); if (!read.IsSuccess) return Result<ResumeWork>.Fail(read.Error);
            var work = read.Value.FirstOrDefault(value => value.MessageId == id);
            if (work is null) return Results.Fail<ResumeWork>("conflict", "Interrupted work changed before exact-history resume");
            var renewed = work with { MessageId = Identity.Identifier(), CheckpointedAt = clock.GetUtcNow().ToUnixTimeMilliseconds() };
            var saved = Save(read.Value.Select(value => value.MessageId == id ? renewed : value).ToArray());
            return saved.IsSuccess ? Result<ResumeWork>.Success(renewed) : Result<ResumeWork>.Fail(saved.Error);
        }
    }
    private Result<Unit> Clear(IReadOnlyList<InterruptedContext> contexts)
    {
        lock (gate)
        {
            var read = Read(); if (!read.IsSuccess) return Result<Unit>.Fail(read.Error);
            if (contexts.Count > 2002 || contexts.Select(value => value.Context).Distinct().Count() != contexts.Count) return Results.Fail<Unit>("invalid", "Duplicate or excessive completed native histories");
            var selected = contexts.ToDictionary(value => value.Context, value => value.SessionId, StringComparer.Ordinal);
            if (read.Value.Any(value => selected.TryGetValue(value.Context, out var session) && session != value.SessionId)) return Results.Fail<Unit>("conflict", "Completed work belongs to another saved native history");
            var next = read.Value.Where(value => !selected.ContainsKey(value.Context)).ToArray();
            return next.Length != read.Value.Count ? Save(next) : Results.Done();
        }
    }
}
