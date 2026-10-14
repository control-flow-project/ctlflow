using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Crossfire.AgentCore;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterPi;

public sealed class PiObservation(RuntimeHooks hooks, Func<string> session, Func<long> now) : IDisposable
{
    private IncrementalHash? digest;
    private long bytes;
    private string? stream;
    private IReadOnlyList<RuntimeSetting> settings = [];
    public void Configure(IReadOnlyList<RuntimeSetting> value) => settings = value;
    public void State(string state, string? error = null) => hooks.Observe?.Invoke(new NativeState("pi", session(), null, state, now(), settings, error is null ? null : PiValues.ErrorText(error)));
    private void Output(string id, string text, string? streamId = null) { if (text.Length != 0) hooks.Observe?.Invoke(new NativeOutput(session(), id, streamId, text)); }
    public void Event(JsonElement value)
    {
        var type = PiValues.Text(value, "type");
        if (type is "agent_start" or "auto_retry_start" or "auto_compaction_start") State("working");
        else if (type == "agent_settled") State("idle");
        else if (type == "message_start" && PiValues.Text(value.GetProperty("message"), "role") == "assistant")
        { digest?.Dispose(); digest = IncrementalHash.CreateHash(HashAlgorithmName.SHA256); stream = Identity.Identifier(); bytes = 0; }
        else if (type == "message_update")
        {
            var change = value.GetProperty("assistantMessageEvent"); if (PiValues.Text(change, "type") != "text_delta") return;
            if (digest is null || stream is null || PiValues.Text(change, "delta") is not { } delta) throw new InvalidDataException("Pi text delta has no exact native message stream");
            Output(stream + ":" + bytes, delta, stream); var encoded = Encoding.UTF8.GetBytes(delta); bytes = checked(bytes + encoded.Length); digest.AppendData(encoded);
        }
        else if (type == "message_end")
        {
            var message = value.GetProperty("message"); var role = PiValues.Text(message, "role"); if (role is not ("assistant" or "toolResult")) return;
            if (!message.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array) throw new InvalidDataException("Invalid native Pi message content");
            var text = new StringBuilder();
            foreach (var part in content.EnumerateArray())
            {
                if (part.ValueKind != JsonValueKind.Object) throw new InvalidDataException("Invalid native Pi content part");
                if (PiValues.Text(part, "type") == "text") text.Append(PiValues.Text(part, "text") ?? throw new InvalidDataException("Invalid native Pi output text"));
            }
            var complete = text.ToString();
            if (role == "assistant" && stream is not null && digest is not null)
            {
                if (bytes == 0) Output(stream + ":0", complete);
                else if (bytes != Encoding.UTF8.GetByteCount(complete) || !digest.GetHashAndReset().AsSpan().SequenceEqual(SHA256.HashData(Encoding.UTF8.GetBytes(complete))))
                    throw new InvalidDataException("Completed Pi text differs from its native stream");
                Dispose();
            }
            else Output(Identity.Identifier(), complete);
        }
        else if (type == "extension_ui_request" && PiValues.Text(value, "method") == "notify" && PiValues.Text(value, "message") is { } text)
            Output(PiValues.Text(value, "id") ?? throw new InvalidDataException("Missing Pi notification identity"), text);
    }
    public void Dispose() { digest?.Dispose(); digest = null; stream = null; bytes = 0; }
}
