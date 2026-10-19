using System.Runtime.CompilerServices;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public static class SyncEvents
{
    public static async IAsyncEnumerable<Result<MessageEvent>> Incremental(MessagingClient messaging, MessageFeed sync, string since, string room, EventFilter filter, [EnumeratorCancellation] CancellationToken cancellation)
    {
        if (!sync.Rooms.TryGetValue(room, out var timeline)) yield break;
        if (!timeline.Limited) { foreach (var value in timeline.Events) if (!ReceivedEvents.Notice(value)) yield return Result<MessageEvent>.Success(value); yield break; }
        var from = since; var recovered = new HashSet<string>(StringComparer.Ordinal); var tailIds = timeline.Events.Select(value => value.EventId).ToHashSet(StringComparer.Ordinal); var visited = new HashSet<string>(StringComparer.Ordinal);
        for (;;)
        {
            var page = await messaging.History(room, new("forward", 100, from, sync.Cursor, filter), cancellation);
            if (!page.IsSuccess) { yield return Result<MessageEvent>.Fail(page.Error); yield break; }
            foreach (var value in page.Value.Events)
            {
                if (tailIds.Contains(value.EventId)) recovered.Add(value.EventId);
                if (!ReceivedEvents.Notice(value)) yield return Result<MessageEvent>.Success(value);
            }
            if (page.Value.Events.Count == 0 || page.Value.End == sync.Cursor) break;
            if (page.Value.End is not { } end || end == from || !visited.Add(end)) { yield return Results.Fail<MessageEvent>("invalid", "Incremental messaging history cursor did not advance"); yield break; }
            from = end;
        }
        foreach (var value in timeline.Events) if (!ReceivedEvents.Notice(value) && !recovered.Contains(value.EventId)) yield return Result<MessageEvent>.Success(value);
    }
    public static void RetainJoined(LocalState storage, string file, IReadOnlySet<string> joined)
    {
        if (!storage.Exists(file)) return; var current = ReceiveState.Load(storage, file); var retained = ReceiveState.Filter(current, joined); if (current.Count == retained.Count) return;
        if (storage.Exists(file + ".ack")) { var pending = AgentIO.Read(storage, file + ".ack"); var receipts = ReceiveState.Cursors(pending.GetProperty("receipts")); if (!receipts.IsSuccess) throw new InvalidDataException(receipts.Error.Message);
            AgentIO.Write(storage, file + ".ack", WireJson.Object(writer => { writer.WritePropertyName("cursors"); ReceiveState.Encode(retained).WriteTo(writer); writer.WritePropertyName("receipts"); ReceiveState.Encode(ReceiveState.Filter(receipts.Value, joined)).WriteTo(writer); })); }
        AgentIO.Write(storage, file, ReceiveState.Encode(retained));
    }
}
