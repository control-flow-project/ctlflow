namespace CtlFlow.Egress.Egressd.Service.Admission;

internal sealed class PrivateAdmission(int maximum)
{
    private int _active;

    internal bool TryAcquire(out int active)
    {
        while (true)
        {
            var current = Volatile.Read(ref _active);
            if (current >= maximum)
            {
                active = current;
                return false;
            }
            if (Interlocked.CompareExchange(
                    ref _active,
                    current + 1,
                    current) == current)
            {
                active = current + 1;
                return true;
            }
        }
    }

    internal void Release() => Interlocked.Decrement(ref _active);
}
