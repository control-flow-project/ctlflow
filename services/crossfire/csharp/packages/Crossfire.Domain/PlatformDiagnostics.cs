using Crossfire.Kernel;

namespace Crossfire.Domain;

public interface PlatformDiagnostics : IDisposable
{
    void Write(string message);
    Result<Unit> Prune();
    void MaintenanceError(string? message);
    string? Error { get; }
}
