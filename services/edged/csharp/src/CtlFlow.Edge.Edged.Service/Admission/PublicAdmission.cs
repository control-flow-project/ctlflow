namespace CtlFlow.Edge.Edged.Service.Admission;

internal sealed class PublicAdmission : IDisposable
{
    private readonly SemaphoreSlim _capacity;

    internal PublicAdmission(int maximumConcurrency) =>
        _capacity = new SemaphoreSlim(
            maximumConcurrency,
            maximumConcurrency);

    internal bool TryAcquire() => _capacity.Wait(0);

    internal void Release() => _capacity.Release();

    public void Dispose() => _capacity.Dispose();
}
