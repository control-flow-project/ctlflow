using System.Text;
using Crossfire.AdapterFilesystem;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class HistoryAcceptance
{
    private static bool Rejected(Action operation)
    { try { operation(); return false; } catch (IOException) { return true; } }
    public static void Verify()
    {
        var directory = PrivateFiles.Directory(Path.Combine(Path.GetTempPath(), "crossfire-history-" + Guid.NewGuid().ToString("N")));
        try
        {
            var file = Path.Combine(directory, "native.jsonl");
            Equal(NativeHistory.Header(directory, file) is null, true, "unmaterialized native header is not fabricated");
            Equal(NativeHistory.Capture(directory, file) is null, true, "unmaterialized native boundary is explicit");
            Equal(NativeHistory.Since(directory, file, null, _ => throw new InvalidOperationException()).Records, 0L, "unmaterialized native history contains no receipt");
            const string header = "{\"type\":\"header\"}\n";
            File.WriteAllText(file, header + "{\"partial\":", new UTF8Encoding(false));
            File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.GroupWrite);
            Equal(NativeHistory.Header(directory, file)!.Value.GetProperty("type").GetString(), "header", "native evidence inside a private home permits its engine's group-readable file mode");
            var captured = NativeHistory.Capture(directory, file)!; Equal(captured.Position, Encoding.UTF8.GetByteCount(header), "a partial native record is not consumed at capture");
            File.AppendAllText(file, "true}\n", new UTF8Encoding(false)); var found = false;
            var inspected = NativeHistory.Since(directory, file, captured, record => found = record.GetProperty("partial").GetBoolean());
            Equal(found, true, "the completed native record is read from the exact prior boundary"); Equal(inspected.Records, 1L, "only appended complete records are counted");
            Equal(inspected.BytesRead < 100, true, "native verification reads only the appended interval, not all history");
            var unicode = "{\"text\":\"" + new string('ä', 50000) + "\"}\n"; var latest = NativeHistory.Capture(directory, file)!;
            File.AppendAllText(file, unicode, new UTF8Encoding(false)); var characters = 0;
            var large = NativeHistory.Since(directory, file, latest, record => characters = record.GetProperty("text").GetString()!.Length);
            Equal(characters, 50000, "UTF-8 history records cross native chunk boundaries intact"); Equal(large.Records, 1L, "one multi-chunk record remains one receipt candidate");
            Equal(large.MaximumBufferedBytes < 400000, true, "history streaming has finite record buffering");
            var saved = Path.Combine(directory, "saved.jsonl"); File.Move(file, saved); File.WriteAllText(file, header, new UTF8Encoding(false));
            Equal(Rejected(() => NativeHistory.Since(directory, file, captured, _ => { })), true, "replacing native history cannot retain the old file identity");
            File.Delete(file); File.Move(saved, file);
            using (var stream = File.OpenWrite(file)) stream.WriteByte((byte)'[');
            Equal(Rejected(() => NativeHistory.Since(directory, file, captured, _ => { })), true, "in-place native prefix replacement invalidates receipt evidence");
            File.Delete(file); File.CreateSymbolicLink(file, Path.Combine(directory, "missing-target"));
            Equal(Rejected(() => NativeHistory.Capture(directory, file)), true, "native history refuses symbolic-link files"); File.Delete(file);
            File.WriteAllText(file, header); File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherWrite);
            Equal(Rejected(() => NativeHistory.Capture(directory, file)), true, "world-writable native history is not evidence"); File.Delete(file);
            Equal(Rejected(() => NativeHistory.Header(directory, Path.Combine(Path.GetTempPath(), "outside-native-history"))), true, "native evidence never escapes its private managed home");
            using (var stream = File.Create(file)) stream.SetLength(NativeHistory.MaximumRecord + 2L);
            Equal(Rejected(() => NativeHistory.Since(directory, file, null, _ => { })), true, "a native history record cannot exceed the finite read bound");
        }
        finally { Directory.Delete(directory, recursive: true); }
    }
}
