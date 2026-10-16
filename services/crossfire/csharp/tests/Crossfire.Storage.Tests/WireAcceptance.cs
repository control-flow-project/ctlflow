using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.Contracts;
using System.Text.Json;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class WireAcceptance
{
    public static void Verify()
    {
        Equal(Pagination.Parse(new Dictionary<string, string>()).Value, (1, 20), "pagination defaults are shared by public and private APIs");
        foreach (var value in new[] { "01", "+1", "1.0", "1e0", "0x1", " 1", "1\n", "١", "", "100001" }) Equal(Pagination.Parse(new Dictionary<string, string> { ["page"] = value }).IsSuccess, false, "noncanonical pagination is rejected: " + value);
        Equal(Pagination.Parse(new Dictionary<string, string> { ["page"] = "100000", ["pageSize"] = "100" }).Value, (100000, 100), "pagination upper bounds are inclusive");
        Equal(IdentitySyntax.Identifier("12345678-abcd-0000-ffff-123456789abc"), true, "canonical identifier belongs to the pure kernel");
        Equal(IdentitySyntax.Identifier("12345678-ABCD-0000-ffff-123456789abc"), false, "identifier validation preserves lowercase wire identity");
        Equal(IdentitySyntax.Identifier("12345678_abcd-0000-ffff-123456789abc"), false, "identifier validation requires exact separators");
        Equal(Validation.Identifier("12345678-abcd-0000-ffff-123456789abc"), true, "wire identifier admission uses the same kernel owner");
        Equal(TextRules.Blank("\ufeff \t\n"), true, "wire whitespace includes BOM");
        Equal(TextRules.Blank("\u0085"), false, "wire whitespace does not include NEL");
        Equal(ProtocolJson.Quote("\ud800"), "\"\\ud800\"", "unpaired high surrogate uses JSON escape");
        Equal(ProtocolJson.Quote("\udfff"), "\"\\udfff\"", "unpaired low surrogate uses JSON escape");
        using var surrogate = JsonDocument.Parse("\"\\ud800\\udfff\\ud800 x\\udfff\"");
        Equal(Validation.Text(surrogate.RootElement).Error.Code, "invalid", "wire admission rejects unpaired UTF-16 instead of silently substituting another value");
        Equal(Validation.Json(surrogate.RootElement), false, "malformed native strings cannot enter canonical JSON inputs");
        using var paired = JsonDocument.Parse("\"\\ud83d\\ude00\"");
        Equal(Validation.Text(paired.RootElement).Value, "😀", "paired Unicode remains valid wire text");
        Equal(ProtocolJson.Unquote("\"\\uD800\\n\\t\\\"\\\\\\/\"").Value, "\ud800\n\t\"\\/", "JSON string decoding owns every escape without surrogate substitution");
        Equal(ProtocolJson.Unquote("\"\\uQQQQ\"").Error.Code, "invalid", "malformed Unicode escape is a typed failure");
        Equal(ProtocolJson.Unquote("\"\\x\"").Error.Code, "invalid", "non-JSON escape is a typed failure");
        Equal(ProtocolJson.Quote("東京 😀\t\n\"\\"), "\"東京 😀\\t\\n\\\"\\\\\"", "wire JSON retains native Unicode and escapes controls");
        Equal(ProtocolJson.Quote("\u0000\u001f"), "\"\\u0000\\u001f\"", "wire JSON uses lowercase control escapes");
        var text = "begin \ud800 😀 \udfff end"; var encoded = WireJson.Object(writer => writer.WriteString("text", text));
        Equal(WireJson.Text(encoded, "text"), text, "protocol construction preserves isolated UTF-16 without replacement");
        Equal(WireJson.Compact(encoded), "{\"text\":\"begin \\ud800 😀 \\udfff end\"}", "protocol serialization uses exact escaped isolated surrogates");
        Equal(WireJson.Build(writer => writer.WriteNumberValue(ulong.MaxValue)).GetRawText(), "18446744073709551615", "native unsigned writer retains its exact complete carrier before protocol-range admission");
        var input = new EnrollmentRoster("@owner:test", "agreements", new("東京 \"Review\" 😀", new Dictionary<string, string>
            { ["aa"] = "a", ["a-b"] = "b", ["zone"] = "India" }),
            [new("ocr-high", "ocr-high", null, new("selected", [new("@zoe:test", true), new("@Zoe:test", false), new("@é:test", true), new("@é:test", false)], ["z", "a"])),
             new("analysis-max", "analysis-max", "00000000-0000-0000-0000-000000000001", new("humans", [], []))]);
        Equal(RosterValues.Digest(input), "699bbaa824716469cc81e8a2ea1cf14efa1043587abb2fab0ea8f0faca0559a4", "canonical enrollment bytes match Node Unicode and stable collation golden");
        Equal(new Page<string>([], 1, 20, 0).TotalPages, 1L, "zero-item collection has one page");
        Equal(new Page<string>([], 1, 100, 9007199254740991).TotalPages, 90071992547410L, "pagination retains exact native integer range");
    }
}
