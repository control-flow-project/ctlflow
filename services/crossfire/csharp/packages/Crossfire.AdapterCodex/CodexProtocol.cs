using System.Text.Json;
using Crossfire.Kernel;

namespace Crossfire.AdapterCodex;

public sealed record NativeEvent(string Method, JsonElement Parameters);
public sealed record NativeRequest(JsonElement Id, string Method, JsonElement Parameters);
public sealed record NativeError(long Code, string Message);
public sealed record NativeReply(JsonElement? Value, NativeError? Error);
public sealed record NativeCallbacks(Action<NativeEvent> Event, Func<NativeRequest, CancellationToken, ValueTask<Result<JsonElement>>> Decision,
    Action<NativeRequest> Responded);

public interface CodexProtocol : IAsyncDisposable
{
    CancellationToken Lifetime { get; }
    ValueTask<Result<NativeReply>> Request(string method, JsonElement parameters, CancellationToken cancellation = default);
    ValueTask<Result<Unit>> Notify(string method, CancellationToken cancellation = default);
}
