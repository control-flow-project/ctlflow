using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Domain;

namespace Crossfire.AdapterPi;

public sealed class PiUsage(RuntimeHooks hooks, Func<string> session)
{
    private TokenCounts? tokens;
    private static long Count(JsonElement input, string name)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(name, out var source)) throw new InvalidDataException("Missing native Pi usage counter");
        var value = Validation.Integer(source); return value.IsSuccess ? value.Value : throw new InvalidDataException("Invalid native Pi usage counter");
    }
    private static TokenCounts Counts(JsonElement input)
    {
        var incoming = Count(input, "input"); var cached = Count(input, "cacheRead"); var writes = Count(input, "cacheWrite"); var outgoing = Count(input, "output");
        var totalInput = checked(incoming + cached + writes); var total = checked(totalInput + outgoing);
        if (total > Validation.MaxWireInteger) throw new InvalidDataException("Native Pi usage counter exceeds its wire contract");
        return new(totalInput, cached, writes, outgoing, null, total);
    }
    private void Report() { if (tokens is not null) hooks.Usage?.Invoke(new("pi", session(), tokens)); }
    public void Initialize(JsonElement input)
    {
        if (PiValues.Text(input, "sessionId") != session()) throw new InvalidDataException("Pi usage belongs to another session");
        tokens = Counts(input.GetProperty("tokens")); Report();
    }
    public void Event(JsonElement value)
    {
        if (tokens is null) return; JsonElement source;
        if (PiValues.Text(value, "type") == "message_end")
        { var message = value.GetProperty("message"); if (PiValues.Text(message, "role") is not ("assistant" or "toolResult") || !message.TryGetProperty("usage", out source)) return; }
        else if (PiValues.Text(value, "type") == "entry_appended")
        { var entry = value.GetProperty("entry"); if (PiValues.Text(entry, "type") is not ("usage" or "compaction" or "branch_summary") || !entry.TryGetProperty("usage", out source)) return; }
        else return;
        if (source.ValueKind == JsonValueKind.Null) return;
        var next = Statistics.Add(tokens, Counts(source)); if (next.Total > Validation.MaxWireInteger) throw new InvalidDataException("Pi cumulative usage counter overflow"); tokens = next; Report();
    }
}
