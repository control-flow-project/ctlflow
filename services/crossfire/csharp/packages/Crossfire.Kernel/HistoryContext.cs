namespace Crossfire.Kernel;

public static class HistoryContext
{
    public const int MaximumLength = 260;
    public static string ForRoom(string room) => "room/" + room;
    public static string? Room(string context) => context.StartsWith("room/", StringComparison.Ordinal) ? context[5..] : null;
    public static bool Valid(string context) => context is "shared" or "control" || Room(context) is { } room && IdentitySyntax.BackendIdentifier(room);
}
