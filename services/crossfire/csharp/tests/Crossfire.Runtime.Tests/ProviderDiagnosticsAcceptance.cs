using Crossfire.AdapterCodex;
using Crossfire.AdapterPi;
using NativePiProvider = Crossfire.AdapterPi.PiProvider;
using Crossfire.AgentCore;
using static Crossfire.Runtime.Tests.Checks;

namespace Crossfire.Runtime.Tests;

public static class ProviderDiagnosticsAcceptance
{
    public static void Verify()
    {
        Equal(CodexProvider.Parse(ModelAcceptance.Json("{\"account\":{},\"requiresOpenaiAuth\":true}")).Value, ProviderState.Present, "Codex provider metadata can confirm a configured account without printing it");
        Equal(CodexProvider.Parse(ModelAcceptance.Json("{\"account\":null,\"requiresOpenaiAuth\":true}")).Value, ProviderState.Missing, "Codex missing account is explicit");
        Equal(CodexProvider.Parse(ModelAcceptance.Json("{\"account\":null,\"requiresOpenaiAuth\":false}")).Value, ProviderState.NotRequired, "A custom provider need not have an OpenAI account");
        foreach (var value in new[] { "null", "[]", "{}", "{\"account\":[],\"requiresOpenaiAuth\":true}", "{\"account\":null,\"requiresOpenaiAuth\":\"true\"}" })
            Equal(CodexProvider.Parse(ModelAcceptance.Json(value)).IsSuccess, false, "Malformed provider metadata is unknown, never an account success");
        var state = ModelAcceptance.Json("{\"model\":{\"provider\":\"fixture\",\"id\":\"selected\"}}");
        Equal(NativePiProvider.Parse(state, ModelAcceptance.Json("{\"models\":[{\"provider\":\"fixture\",\"id\":\"selected\"}]}")).Value, ProviderState.Present, "Pi checks the selected provider and model");
        Equal(NativePiProvider.Parse(state, ModelAcceptance.Json("{\"models\":[{\"provider\":\"other\",\"id\":\"selected\"}]}")).Value, ProviderState.Missing, "Another provider's model does not authenticate this one");
        foreach (var value in new[] { "null", "{}", "{\"models\":[null]}", "{\"models\":[{\"id\":\"selected\"}]}" })
            Equal(NativePiProvider.Parse(state, ModelAcceptance.Json(value)).IsSuccess, false, "Invalid Pi provider metadata cannot claim readiness");
    }
}
