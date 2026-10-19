using System.Text.Json;
using Crossfire.Kernel;
using Crossfire.Contracts;

namespace Crossfire.AdapterMatrix;

public sealed record InvitationState(string Since, IReadOnlyDictionary<string, string> Senders);
public static class InvitationSynchronization
{
    public const string Filter = "{\"room\":{\"timeline\":{\"limit\":0},\"state\":{\"types\":[\"m.room.member\"]},\"ephemeral\":{\"types\":[]},\"account_data\":{\"types\":[]}},\"presence\":{\"types\":[]},\"account_data\":{\"types\":[]}}";
    public static Result<InvitationState> Apply(JsonElement value, string self, InvitationState? previous)
    {
        var since = WireJson.Text(value, "next_batch"); if (since is null || since.Length is < 1 or > 1024 || !MatrixSyntax.UserId(self)) return Results.Fail<InvitationState>("native", "Invalid native invitation synchronization");
        if (!value.TryGetProperty("rooms", out var rooms)) rooms = WireJson.Object(_ => { }); if (rooms.ValueKind != JsonValueKind.Object) return Results.Fail<InvitationState>("native", "Invalid native invitation room updates"); var senders = previous is null ? new Dictionary<string, string>(StringComparer.Ordinal) : new Dictionary<string, string>(previous.Senders, StringComparer.Ordinal);
        foreach (var section in new[] { "invite", "join", "leave" })
        {
            if (!rooms.TryGetProperty(section, out var selected)) continue; if (selected.ValueKind != JsonValueKind.Object || selected.EnumerateObject().Count() > 1000) return Results.Fail<InvitationState>("native", "Invalid native invitations");
            foreach (var room in selected.EnumerateObject())
            {
                if (!MatrixSyntax.RoomId(room.Name)) return Results.Fail<InvitationState>("native", "Invalid native invitation room identity"); if (section != "invite") { senders.Remove(room.Name); continue; }
                if (room.Value.ValueKind != JsonValueKind.Object || !room.Value.TryGetProperty("invite_state", out var state) || state.ValueKind != JsonValueKind.Object || !state.TryGetProperty("events", out var events) || events.ValueKind != JsonValueKind.Array || events.GetArrayLength() > 1000) return Results.Fail<InvitationState>("native", "Invalid native invitation state"); string? sender = null;
                foreach (var item in events.EnumerateArray())
                {
                    if (item.ValueKind != JsonValueKind.Object) return Results.Fail<InvitationState>("native", "Invalid native invitation event"); if (WireJson.Text(item, "type") != "m.room.member" || WireJson.Text(item, "state_key") != self) continue; sender = WireJson.Text(item, "sender");
                    if (!item.TryGetProperty("content", out var content) || WireJson.Text(content, "membership") != "invite" || sender is null || !MatrixSyntax.UserId(sender)) return Results.Fail<InvitationState>("native", "Invalid native invitation author");
                }
                if (sender is null) return Results.Fail<InvitationState>("native", "Native invitation has no recipient membership"); senders[room.Name] = sender;
            }
        }
        return senders.Count > 1000 ? Results.Fail<InvitationState>("native", "Native invitation count exceeds the recipient bound") : Result<InvitationState>.Success(new(since, senders));
    }
}
