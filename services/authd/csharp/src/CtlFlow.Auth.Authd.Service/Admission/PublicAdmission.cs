namespace CtlFlow.Auth.Authd.Service.Admission;

internal sealed class PublicAdmission : IDisposable
{
    private const int PublicCapacity = 128;
    private const int CallbackCapacity = 32;
    private readonly SemaphoreSlim _publicRequests =
        new(PublicCapacity, PublicCapacity);
    private readonly SemaphoreSlim _callbacks =
        new(CallbackCapacity, CallbackCapacity);
    private readonly TokenBucket _begin = new(20, 2);
    private readonly TokenBucket _callback = new(40, 4);
    private readonly TokenBucket _logout = new(20, 2);

    internal bool TryAcquirePublic() => _publicRequests.Wait(0);

    internal void ReleasePublic() => _publicRequests.Release();

    internal bool TryAcquireCallback() => _callbacks.Wait(0);

    internal void ReleaseCallback() => _callbacks.Release();

    internal bool TryAcquireRoute(PathString path) =>
        path == "/auth/v1/begin"
            ? _begin.TryAcquire()
            : path == "/auth/v1/callback"
                ? _callback.TryAcquire()
                : path == "/auth/v1/logout"
                    ? _logout.TryAcquire()
                    : true;

    internal int PublicInFlight =>
        PublicCapacity - _publicRequests.CurrentCount;

    internal int CallbacksInFlight =>
        CallbackCapacity - _callbacks.CurrentCount;

    public void Dispose()
    {
        _callbacks.Dispose();
        _publicRequests.Dispose();
    }
}
