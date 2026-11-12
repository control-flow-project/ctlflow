using System.Diagnostics;
using System.Net.Sockets;
using Crossfire.AdapterProcess;

namespace Fleetd.AdapterExecution.Vm;

// Every helper belongs to one transient execution service, never the shared
// user libvirt daemon. Keep a bounded diagnostic tail while draining its pipes.
internal sealed class Helper : IAsyncDisposable
{
    public NativeProcess Process { get; }
    private readonly Task output, errors;
    private readonly object gate = new();
    private string tail = "";
    public string Diagnostic { get { lock (gate) return tail; } }
    public Helper(NativeCommand command)
    {
        var opened = NativeProcess.Start(command);
        if (!opened.IsSuccess) throw new IOException(opened.Error.Message);
        Process = opened.Value; output = Drain(Process.Output); errors = Drain(Process.Errors);
    }
    private async Task Drain(StreamReader reader)
    {
        var buffer = new char[4096];
        for (;;)
        {
            var count = await reader.ReadAsync(buffer);
            if (count == 0) return;
            lock (gate) { tail += new string(buffer, 0, count); if (tail.Length > 16384) tail = tail[^16384..]; }
        }
    }
    public void Check()
    { if (Process.Ended.IsCompleted) throw new IOException("VM helper exited unexpectedly: " + Diagnostic); }
    public async ValueTask DisposeAsync()
    {
        await Process.DisposeAsync(); await Task.WhenAll(output, errors);
    }
    internal static async Task Wait(Func<bool> observed, IReadOnlyList<Helper> helpers, int seconds, CancellationToken cancellation)
    {
        var elapsed = Stopwatch.StartNew();
        while (!observed())
        {
            cancellation.ThrowIfCancellationRequested(); foreach (var helper in helpers) helper.Check();
            if (elapsed.Elapsed >= TimeSpan.FromSeconds(seconds))
                throw new IOException("VM prerequisite did not become ready within " + seconds + " seconds: " + string.Join('\n', helpers.Select(helper => helper.Diagnostic)));
            await Task.Delay(25, cancellation);
        }
    }
    internal static bool SocketReady(string path)
    {
        using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        try { socket.Connect(new UnixDomainSocketEndPoint(path)); return true; }
        catch (SocketException error) when (error.SocketErrorCode is SocketError.ConnectionRefused or SocketError.AddressNotAvailable || error.ErrorCode == 2) { return false; }
    }
}
