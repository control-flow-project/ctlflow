using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;

namespace Fleetd.AdapterExecution.Vm;

internal static class Receipt
{
    public static void Write(VmRequest request, long started, long? ready, long? ended, string? error)
    {
        var value = WireJson.Object(writer =>
        {
            writer.WriteString("id", request.Id); writer.WriteString("state", error is not null ? "failed" : ended is not null ? "closed" : ready is not null ? "ready" : "starting");
            writer.WriteNumber("startedAt", started);
            if (ready is { } readyAt) writer.WriteNumber("readyAt", readyAt);
            if (ended is { } endedAt) writer.WriteNumber("endedAt", endedAt);
            if (error is not null) writer.WriteString("error", TextRules.TruncateUtf16(error, 8192));
        });
        PrivateFiles.Write(Path.Combine(request.Native.Directory, "vm-receipt.json"), WireJson.Bytes(value), 65536);
    }
}
