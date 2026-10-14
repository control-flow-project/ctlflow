using System.Text.Json;
using Crossfire.AdapterFilesystem;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class DiagnosticAcceptance
{
    public static void Verify(string parent)
    {
        var directory = Path.Combine(parent, "diagnostics"); var now = DateTimeOffset.Parse("2026-10-01T10:00:00Z").ToUnixTimeMilliseconds();
        using var diagnostics = new DiagnosticStore(directory, 7, () => now);
        var longMessage = string.Concat(Enumerable.Repeat("𐐀é-secret", 20000));
        diagnostics.Write(longMessage); diagnostics.Write("second entry");
        Equal(diagnostics.Error is null, true, "bounded diagnostic writes preserve UTF-8 across chunks");
        var path = Path.Combine(directory, "2026-10-01.jsonl"); var records = File.ReadLines(path).Select(line => JsonDocument.Parse(line)).ToArray();
        try
        {
            Equal(records.Length > 2, true, "large diagnostic message is written as bounded records");
            Equal(string.Concat(records[..^1].Select(record => record.RootElement.GetProperty("message").GetString())), longMessage, "diagnostic chunks reconstruct the exact multibyte message");
            Equal(records[^1].RootElement.GetProperty("message").GetString(), "second entry", "append does not replace prior records");
        }
        finally { foreach (var record in records) record.Dispose(); }
        now += 3600000; diagnostics.Write("at the boundary");
        now += 7 * 86400000L;
        Equal(diagnostics.Prune().IsSuccess, true, "boundary partition is filtered at record timestamps");
        Equal(File.ReadAllLines(path).Length, 1, "records older than exact cutoff are removed");
        Equal(File.ReadAllText(path).Contains("at the boundary", StringComparison.Ordinal), true, "exact cutoff record is preserved");
        now++; Equal(diagnostics.Prune().IsSuccess, true, "next millisecond expires the boundary record");
        Equal(File.Exists(path), false, "empty diagnostic partition is removed");
        diagnostics.Write("current"); diagnostics.MaintenanceError("database unavailable");
        Equal(diagnostics.Error, "database unavailable", "non-file maintenance failures remain visible in health");
        diagnostics.MaintenanceError(null); Equal(diagnostics.Error is null, true, "successful maintenance clears its own health error");
        var malformed = Path.Combine(directory, "2026-10-01.jsonl");
        PrivateFiles.Write(malformed, "incomplete"u8, 1024); now = DateTimeOffset.Parse("2026-10-08T12:00:00Z").ToUnixTimeMilliseconds();
        Equal(diagnostics.Prune().IsSuccess, false, "malformed boundary records are not silently deleted");
        Equal(File.ReadAllText(malformed), "incomplete", "failed trim preserves the original file");
        Equal(System.IO.Directory.GetFiles(directory, "*.pending-*").Length, 0, "failed trim removes its owned temporary");
        File.Delete(malformed); Equal(diagnostics.Prune().IsSuccess, true, "repaired diagnostic storage recovers without restart");
        var foreign = Path.Combine(parent, "foreign-log"); PrivateFiles.Write(foreign, "preserve"u8, 100);
        File.CreateSymbolicLink(malformed, foreign);
        Equal(diagnostics.Prune().IsSuccess, false, "diagnostic cleanup refuses a partition symlink");
        Equal(File.ReadAllText(foreign), "preserve", "cleanup cannot delete a symlink destination");
        File.Delete(malformed); System.IO.Directory.CreateDirectory(malformed);
        Equal(diagnostics.Prune().IsSuccess, false, "unexpected partition directory is not ignored");
        System.IO.Directory.Delete(malformed); diagnostics.Dispose(); diagnostics.Write("after close");
        Equal(diagnostics.Error is not null, true, "writes after disposal report failure without reopening storage");
        Equal(diagnostics.Prune().IsSuccess, false, "closed diagnostics cannot resume cleanup");
    }
}
