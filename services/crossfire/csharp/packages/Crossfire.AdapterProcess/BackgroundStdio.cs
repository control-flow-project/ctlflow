using System.Runtime.InteropServices;

namespace Crossfire.AdapterProcess;

public static partial class BackgroundStdio
{
    [LibraryImport("libc", EntryPoint = "open", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Open(string file, int flags);
    [LibraryImport("libc", EntryPoint = "dup2", SetLastError = true)]
    private static partial int Duplicate(int descriptor, int target);
    [LibraryImport("libc", EntryPoint = "close", SetLastError = true)]
    private static partial int Close(int descriptor);
    public static void RedirectToNull()
    {
        if (!OperatingSystem.IsLinux()) throw new PlatformNotSupportedException("Native background controller startup requires Linux"); var descriptor = Open("/dev/null", 2 | 0x80000); if (descriptor < 0) throw new IOException("Cannot open background controller standard streams");
        try { for (var stream = 0; stream < 3; stream++) if (Duplicate(descriptor, stream) < 0) throw new IOException("Cannot detach background controller standard streams"); } finally { Close(descriptor); }
    }
}
