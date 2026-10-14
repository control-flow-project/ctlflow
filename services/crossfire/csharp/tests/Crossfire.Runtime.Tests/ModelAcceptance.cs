using System.Text.Json;
using Crossfire.AdapterCodex;
using Crossfire.Kernel;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ModelAcceptance
{
    public static JsonElement Json(string text) { using var document = JsonDocument.Parse(text); return document.RootElement.Clone(); }
    public static async Task Verify()
    {
        var models = "[{\"model\":\"first\",\"isDefault\":true,\"defaultReasoningEffort\":\"medium\",\"supportedReasoningEfforts\":[{\"reasoningEffort\":\"medium\"},{\"reasoningEffort\":\"high\"},{\"reasoningEffort\":\"max\"}]}]";
        await using var defaults = new Catalog("{}", [(models, null)]);
        var selected = await ModelAdmission.Read(defaults, new(null, null, "danger-full-access", "on-request", null), CancellationToken.None);
        Equal(selected.Value, new NativeSelection("first", "medium"), "native catalog default is selected only when uniquely advertised");
        await using var high = new Catalog("{\"model\":\"first\",\"model_reasoning_effort\":\"medium\"}", [(models, null)]);
        Equal((await ModelAdmission.Read(high, new("first", "max", "danger-full-access", "on-request", null), CancellationToken.None)).Value.Effort, "max", "per-instance effort wins over effective native defaults");
        await using var unavailable = new Catalog("{}", [(models, null)]);
        Equal((await ModelAdmission.Read(unavailable, new("missing", "max", "danger-full-access", "on-request", null), CancellationToken.None)).Error.Code, "invalid", "unavailable model is rejected rather than substituted");
        await using var effort = new Catalog("{}", [(models, null)]);
        Equal((await ModelAdmission.Read(effort, new("first", "xhigh", "danger-full-access", "on-request", null), CancellationToken.None)).Error.Code, "invalid", "unavailable effort is rejected rather than substituted");
        await using var repeated = new Catalog("{}", [(models, "same"), ("[{\"model\":\"second\",\"isDefault\":false,\"defaultReasoningEffort\":\"high\",\"supportedReasoningEfforts\":[{\"reasoningEffort\":\"high\"}]}]", "same")]);
        Equal((await ModelAdmission.Read(repeated, new(null, null, "danger-full-access", "on-request", null), CancellationToken.None)).IsSuccess, false, "native catalog cursor cycles are rejected");
        await using var duplicate = new Catalog("{}", [(models, "next"), (models, null)]);
        Equal((await ModelAdmission.Read(duplicate, new(null, null, "danger-full-access", "on-request", null), CancellationToken.None)).IsSuccess, false, "duplicate native model identities are rejected");
    }
    private sealed class Catalog(string configuration, IReadOnlyList<(string Data, string? Cursor)> pages) : CodexProtocol
    {
        private int page;
        public CancellationToken Lifetime => CancellationToken.None;
        public ValueTask<Result<NativeReply>> Request(string method, JsonElement parameters, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            if (method == "config/read") return ValueTask.FromResult(Result<NativeReply>.Success(new(Json("{\"config\":" + configuration + "}"), null)));
            Equal(method, "model/list", "admission uses the native model catalog"); Equal(parameters.GetProperty("includeHidden").GetBoolean(), true, "hidden available models remain eligible");
            if (page > 0) Equal(parameters.GetProperty("cursor").GetString(), pages[page - 1].Cursor, "native catalog cursor is exact");
            var selected = pages[page++]; return ValueTask.FromResult(Result<NativeReply>.Success(new(Json("{\"data\":" + selected.Data + ",\"nextCursor\":" + (selected.Cursor is null ? "null" : ProtocolJson.Quote(selected.Cursor)) + "}"), null)));
        }
        public ValueTask<Result<Unit>> Notify(string method, CancellationToken cancellation) => ValueTask.FromResult(Results.Done());
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
