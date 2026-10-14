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
    public ResumeFiles(string state, TimeProvider clock) { this.clock = clock; file = Path.Combine(PrivateFiles.Directory(state), "resume-work.json"); Port = new(Read, Capture, Acknowledge); }
    private Result<IReadOnlyList<ResumeWork>> Read() => ConfigurationFiles.Boundary(() =>
    {
        lock (gate)
        {
            if (!PrivateFiles.Exists(file)) return Result<IReadOnlyList<ResumeWork>>.Success([]); var parsed = Validation.List(WireJson.Parse(PrivateFiles.Read(file, 2097152)), value =>
            {
                if (!Validation.Fields(value, ["context", "sessionId", "messageId", "checkpointedAt"]).IsSuccess) return Results.Fail<ResumeWork>("invalid", "Invalid interrupted-work checkpoint");
                var context = Validation.Text(value.GetProperty("context"), 255); var session = Validation.Text(value.GetProperty("sessionId"), 200); var id = WireJson.Text(value, "messageId"); var at = Validation.Integer(value.GetProperty("checkpointedAt"), 0, 8640000000000000);
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
            var read = Read(); if (!read.IsSuccess) return Result<Unit>.Fail(read.Error); var next = read.Value.ToDictionary(value => value.Context, StringComparer.Ordinal); var changed = false;
            foreach (var context in contexts) { if (next.TryGetValue(context.Context, out var value)) { if (value.SessionId != context.SessionId) return Results.Fail<Unit>("conflict", "Interrupted work belongs to another saved native history"); } else { if (next.Count >= 2002) return Results.Fail<Unit>("limit", "Interrupted-work context capacity reached"); next.Add(context.Context, new(context.Context, context.SessionId, Identity.Identifier(), clock.GetUtcNow().ToUnixTimeMilliseconds())); changed = true; } }
            return changed ? Save(next.Values.ToArray()) : Results.Done();
        }
    }
    private Result<Unit> Acknowledge(string id) { lock (gate) { var read = Read(); if (!read.IsSuccess) return Result<Unit>.Fail(read.Error); return read.Value.Any(value => value.MessageId == id) ? Save(read.Value.Where(value => value.MessageId != id).ToArray()) : Results.Done(); } }
}
