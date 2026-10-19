using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Storage.Tests;

public static class MessagingFixture
{
    private static ValueTask<Result<T>> Unexpected<T>() => throw new InvalidOperationException("Unexpected messaging operation in a storage fixture");
    public static MessagingPorts Ports() => new(
        origin => new("fixture", "Test channel", origin + "/chat", origin + "/signup", [], new("fixture", WireJson.Object(_ => { }))),
        (_, _, _) => Unexpected<string>(), id => "agent/" + id, () => "service", id => id,
        input => Result<string>.Success(input.Username),
        (user, token) => new(user, token, WireJson.Object(_ => { })),
        (_, _) => Unexpected<string>(), (_, _) => Unexpected<bool>(), (_, _, _, _) => Unexpected<BackendAccount>(),
        (_, _) => Unexpected<Unit>(), (_, _) => Unexpected<Unit>(), (_, _) => Unexpected<string?>(), (_, _, _) => Unexpected<Unit>(),
        (_, _) => Unexpected<IReadOnlyList<string>>(), (_, _, _, _, _) => Unexpected<string>(), (_, _, _, _) => Unexpected<Unit>(),
        (_, _, _, _) => Unexpected<Unit>(), (_, _, _, _) => Unexpected<RoomFacts>(), (_, _, _, _) => Unexpected<RoomMembership>(),
        (_, _, _) => Unexpected<RoomInvitation?>(), (_, _, _, _, _) => Unexpected<RoomFacts>(),
        (_, _, _, _, _, _) => Unexpected<RoomMembership>(), (_, _, _) => Unexpected<Unit>(),
        (_, _, _, _) => Unexpected<BackendEvent>(), (_, _, _, _, _, _) => Unexpected<string>());
}
