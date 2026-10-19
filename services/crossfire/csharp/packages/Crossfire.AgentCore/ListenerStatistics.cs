using System.Text;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public sealed class ListenerStatistics(string self, TimeProvider clock)
{
    private readonly object gate = new();
    private readonly Dictionary<(string Room, string Sender, string Type), TrafficFlow> flows = [];
    private readonly Dictionary<(string Runtime, string Session), UsageSample> usage = [];
    private readonly Dictionary<(string Room, string Event), (bool Observed, bool Delivered, LinkedListNode<(string Room, string Event)> Order)> recent = [];
    private readonly LinkedList<(string Room, string Event)> order = [];
    private long started = clock.GetUtcNow().ToUnixTimeMilliseconds(), sequence, dropped;
    private StatisticsBatch? pending;
    public void Record(IReadOnlyList<ReceivedEvent> events, bool delivered)
    {
        lock (gate) foreach (var value in events)
        {
            if (value.Type != "message" || value.Sender == self || ReceivedEvents.Notice(value)) continue;
            var eventKey = (value.RoomId, value.EventId);
            var previous = recent.GetValueOrDefault(eventKey); if (delivered ? previous.Delivered : previous.Observed) continue;
            var raw = value.Content.Kind;
            var type = TextRules.WellFormed(raw) ? TextRules.TruncateUtf16(raw, 100) : "unknown";
            if (type.Length == 0 || type.Any(character => character is <= '\u001f' or '\u007f')) type = "unknown";
            var key = (value.RoomId, value.Sender, type); if (!flows.TryGetValue(key, out var flow)) { if (flows.Count >= 256) { dropped++; continue; } flow = new(value.RoomId, value.Sender, type, new()); }
            var bytes = value.ContentFile?.SourceBytes ?? Encoding.UTF8.GetByteCount(WireJson.Compact(MessageJson.Content(value.Content))); long attachment = value.ContentFile?.AttachmentBytes ?? 0;
            if (value.ContentFile is null) attachment = checked(value.Content.Attachments.Sum(item => item.Bytes ?? 0));
            var totals = flow.Totals; var next = new TrafficTotals(checked(totals.Observed + (previous.Observed ? 0 : 1)), checked(totals.Delivered + (delivered ? 1 : 0)), checked(totals.ContentBytes + (previous.Observed ? 0 : bytes)), checked(totals.DeliveredBytes + (delivered ? bytes : 0)), checked(totals.AttachmentBytes + (previous.Observed ? 0 : attachment)), Math.Max(totals.LargestBytes, bytes));
            if (!Count(next.Observed) || !Count(next.Delivered) || !Count(next.ContentBytes) || !Count(next.DeliveredBytes)
                || !Count(next.AttachmentBytes) || !Count(next.LargestBytes)) { dropped++; continue; }
            flows[key] = flow with { Totals = next };
            if (previous.Order is not null) order.Remove(previous.Order); recent[eventKey] = (true, previous.Delivered || delivered, order.AddLast(eventKey));
            if (recent.Count > 2048) { var first = order.First!; recent.Remove(first.Value); order.RemoveFirst(); }
        }
    }
    private static bool Count(long value) => value is >= 0 and <= Validation.MaxWireInteger;
    public void Usage(UsageSample sample)
    {
        lock (gate)
        {
            var tokens = sample.Tokens; var counts = new long?[] { tokens.Input, tokens.CachedInput, tokens.CacheWriteInput, tokens.Output, tokens.ReasoningOutput, tokens.Total };
            if (sample.Runtime.Length is < 1 or > 100 || sample.SessionId.Length is < 1 or > 255 || !TextRules.WellFormed(sample.Runtime) || !TextRules.WellFormed(sample.SessionId)
                || sample.Runtime.Any(character => character is <= '\u001f' or '\u007f') || sample.SessionId.Any(character => character is <= '\u001f' or '\u007f')
                || counts.Any(value => value is < 0 or > Validation.MaxWireInteger) || tokens.CachedInput > tokens.Input || tokens.CacheWriteInput > tokens.Input || tokens.ReasoningOutput > tokens.Output || !usage.ContainsKey((sample.Runtime, sample.SessionId)) && usage.Count >= 32) { dropped++; return; }
            usage[(sample.Runtime, sample.SessionId)] = sample;
        }
    }
    public StatisticsBatch? Batch(bool force = false)
    {
        lock (gate)
        {
            if (pending is not null) return pending; var ended = Math.Max(started, clock.GetUtcNow().ToUnixTimeMilliseconds());
            if (!force && ended - started < 300000 || flows.Count == 0 && usage.Count == 0 && dropped == 0) return null;
            pending = new(++sequence, started, ended, dropped, flows.Values.ToArray(), usage.Values.ToArray()); flows.Clear(); usage.Clear(); dropped = 0; started = ended; return pending;
        }
    }
    public void Acknowledge(StatisticsBatch? batch) { lock (gate) if (ReferenceEquals(batch, pending)) pending = null; }
}
