namespace Crossfire.Runtime.Tests;

public static class Checks
{
    private static int passed;
    public static int Passed => Volatile.Read(ref passed);
    public static void Equal<T>(T actual, T expected, string label)
    {
        if (!EqualityComparer<T>.Default.Equals(actual, expected)) throw new InvalidOperationException(label + ": expected " + expected + ", got " + actual);
        Interlocked.Increment(ref passed);
    }
}
