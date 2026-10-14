using System.Text.Json;
using Crossfire.Contracts;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class RoomAcceptance
{
    public static void Verify()
    {
        foreach (var malformedText in new[] { "\ud800", "\udfff", "before\ud800after", "\ud800🚀" })
        {
            Equal(Validation.WellFormed(malformedText), false, "malformed Unicode rejected without replacement");
            Equal(Validation.UserId("@" + malformedText + ":example.test"), false, "malformed Matrix identity rejected");
        }
        foreach (var malformedJson in new[] { "\"\\ud800\"", "{\"\\udfff\":true}" })
        {
            using var input = JsonDocument.Parse(malformedJson);
            Equal(Validation.Json(input.RootElement), false, "malformed JSON text rejected at boundary");
        }
        using (var malformedString = JsonDocument.Parse("\"\\ud800\""))
        {
            Equal(Validation.Text(malformedString.RootElement).IsSuccess, false, "text parser returns expected malformed Unicode failure");
            Equal(Validation.PlainText(malformedString.RootElement, 8192).IsSuccess, false, "plain-text parser returns expected malformed Unicode failure");
        }
        Equal(Validation.TruncateUtf16("a🚀b", 2), "a", "truncation never separates Unicode scalar");
        Equal(Validation.TruncateUtf16("a🚀b", 3), "a🚀", "truncation preserves complete Unicode scalar");
        Equal(Validation.TruncateUtf16("🚀", 0), "", "zero text bound");
        Equal(Validation.TruncateUtf16("🚀", 1), "", "surrogate pair does not fit one unit");
        Equal(Validation.TruncateUtf16("🚀", 2), "🚀", "surrogate pair fits exactly");
        using var document = JsonDocument.Parse("""
        [
          {"sender":"@owner:example.test","type":"m.room.create","state_key":"","content":{"room_version":"12","additional_creators":["@agent:example.test"]}},
          {"sender":"@owner:example.test","type":"m.room.join_rules","state_key":"","content":{"join_rule":"invite"}},
          {"sender":"@owner:example.test","type":"m.room.history_visibility","state_key":"","content":{"history_visibility":"joined"}},
          {"sender":"@owner:example.test","type":"m.room.member","state_key":"@owner:example.test","content":{"membership":"join"}},
          {"sender":"@owner:example.test","type":"m.room.member","state_key":"@agent:example.test","content":{"membership":"join"}}
        ]
        """);
        var state = RoomState.Parse(document.RootElement);
        Equal(state.IsSuccess, true, "native room state parsing");
        Equal(RoomState.Creators(state.Value).Value.Count, 2, "native version-12 creator authority");
        Equal(RoomState.OwnerConversation(state.Value, "@owner:example.test", "@agent:example.test").IsSuccess, true, "private owner conversation");
        var publicMember = state.Value[3] with { StateKey = "@outsider:example.test" };
        Equal(RoomState.OwnerConversation(state.Value.Append(publicMember).ToArray(), "@owner:example.test", "@agent:example.test").Error.Code,
            "forbidden", "owner observations never enter a third-party room");
        using var encryption = JsonDocument.Parse("{}");
        Equal(RoomState.OwnerConversation(state.Value.Append(new("@owner:example.test", "m.room.encryption", "", encryption.RootElement)).ToArray(),
            "@owner:example.test", "@agent:example.test").Error.Code, "forbidden", "unsupported encrypted owner conversation rejected");
        using var levels = JsonDocument.Parse("{\"users\":{\"@owner:example.test\":100},\"events\":{\"m.room.message\":0,\"m.reaction\":5},\"state_default\":50}");
        var powers = RoomState.Powers(levels.RootElement, "@owner:example.test");
        Equal(powers.Value.OwnerLevel, 100L, "native owner power level");
        Equal(powers.Value.Ceiling, -1L, "read-only ceiling remains below invite authority");
        Equal(powers.Value.Reaction, 5L, "reaction authority preserves configured level");
        using var malformed = JsonDocument.Parse("{\"users_default\":null}");
        Equal(RoomState.Powers(malformed.RootElement, "@owner:example.test").IsSuccess, false, "invalid power default is not substituted");
    }
}
