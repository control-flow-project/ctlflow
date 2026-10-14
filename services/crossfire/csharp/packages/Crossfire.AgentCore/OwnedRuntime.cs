using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AgentCore;

public enum NativeHistoryMode { Shared, PerRoom }
public sealed record RuntimeAttachment(string Runtime, string SessionId, string Workspace, IReadOnlyDictionary<string, string> Connection);
public sealed record RuntimeTerminalAdapter(Func<RuntimeAttachment, Result<string>> Command);
public sealed record ContextAttachment(string Context, RuntimeAttachment Attachment);
public sealed record SavedRuntimeContext(string Context, string Runtime, string SessionId, string Workspace);
public sealed record RuntimeInspectionInput(string Workspace, string StateDirectory, JsonElement Options);
public sealed record RuntimeResetInput(string Workspace, string StateDirectory, string ResetId);
public sealed record ValidatedRuntime(JsonElement Options, RuntimeApproval Approval);
public sealed record OwnedRuntimeInput(string Profile, string Name, string Workspace, string StateDirectory, string Instructions, JsonElement Options,
    RuntimeHooks Hooks, NativeHistoryMode HistoryMode = NativeHistoryMode.Shared, bool AllowNewHistory = false);
public interface OwnedRuntimeConnection : RuntimeConnection
{
    RuntimeAttachment? Attachment { get; }
    ValueTask<Result<IReadOnlyList<ContextAttachment>>> Attachments();
}
public sealed record OwnedRuntimeAdapter(
    Func<JsonElement, IReadOnlyList<RuntimeSetting>> ConfiguredSettings,
    Func<JsonElement, Result<ValidatedRuntime>> Validate,
    Func<RuntimeInspectionInput, CancellationToken, ValueTask<Result<Unit>>> Inspect,
    Func<string, string, Result<IReadOnlyList<SavedRuntimeContext>>> SavedContexts,
    Func<RuntimeResetInput, Result<Unit>> Reset,
    Func<OwnedRuntimeInput, CancellationToken, ValueTask<Result<OwnedRuntimeConnection>>> Start);
