using Crossfire.AdapterFilesystem;

namespace Crossfire.AdapterPi;

public static class PiReceipt
{
    public static bool Received(string home, string history, NativeFileBoundary boundary, PiPublication input, string? leaf)
    {
        var parents = new Dictionary<string, string?>(StringComparer.Ordinal); var markers = new HashSet<string>(StringComparer.Ordinal); var users = new HashSet<string>(StringComparer.Ordinal);
        NativeHistory.Since(home, history, boundary, value =>
        {
            var id = PiValues.Text(value, "id"); if (id is null || !value.TryGetProperty("parentId", out var parent) || parent.ValueKind is not (System.Text.Json.JsonValueKind.String or System.Text.Json.JsonValueKind.Null))
                throw new IOException("Invalid Pi native history tree entry");
            parents[id] = parent.GetString();
            if (PiValues.Text(value, "type") == "custom" && PiValues.Text(value, "customType") == "crossfire-input")
            {
                var data = value.GetProperty("data"); if (PiValues.Text(data, "messageId") == input.MessageId && PiValues.Text(data, "text") == input.Text) markers.Add(id);
            }
            if (PiValues.Text(value, "type") == "message")
            {
                var message = value.GetProperty("message");
                if (PiValues.Text(message, "role") == "user" && message.TryGetProperty("content", out var content) && content.ValueKind == System.Text.Json.JsonValueKind.Array && content.GetArrayLength() == 1
                    && PiValues.Text(content[0], "type") == "text" && PiValues.Text(content[0], "text") == input.Text && parent.ValueKind == System.Text.Json.JsonValueKind.String && markers.Contains(parent.GetString()!)) users.Add(id);
            }
        });
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var id = leaf; id is not null && parents.TryGetValue(id, out var parent); id = parent)
        {
            if (!seen.Add(id)) throw new IOException("Pi native history contains a cycle");
            if (users.Contains(id)) { NativeHistory.MakePrivateAndFlush(home, history); return true; }
        }
        return false;
    }
}
