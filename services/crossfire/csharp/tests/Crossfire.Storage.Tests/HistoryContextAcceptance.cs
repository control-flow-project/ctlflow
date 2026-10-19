using Crossfire.Kernel;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class HistoryContextAcceptance
{
    public static void Verify()
    {
        foreach (var room in new[] { "shared", "control", "room/x", "__proto__", "é/🙂", new string('a', 255) })
        {
            var context = HistoryContext.ForRoom(room);
            Equal(HistoryContext.Room(context), room, "room history identifiers round trip exactly");
            Equal(HistoryContext.Valid(context) && context is not ("shared" or "control") && context.Length <= HistoryContext.MaximumLength, true, "opaque rooms cannot collide with private contexts");
        }
        Equal(HistoryContext.Room("shared") is null && HistoryContext.Room("control") is null && HistoryContext.Valid("shared") && HistoryContext.Valid("control"), true, "private histories have no room attribution");
        foreach (var room in new[] { "", new string('a', 256), "bad\nroom", "\u007f", "\ud800" }) Equal(HistoryContext.Valid(HistoryContext.ForRoom(room)), false, "room contexts enforce the current identifier boundary");
    }
}
