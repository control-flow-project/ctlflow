using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterClient;

public sealed class AgentInvitations(AgentMatrix matrix, string self)
{
    private InvitationState? state;
    public async ValueTask<Result<IReadOnlyList<string>>> Read(CancellationToken cancellation)
    {
        var query = new Dictionary<string, string> { ["timeout"] = "0", ["filter"] = InvitationSynchronization.Filter }; if (state is not null) query["since"] = state.Since;
        var response = await AgentIO.Request(matrix, new("GET", AgentIO.MatrixApi + "/sync", Query: query, MaximumBytes: AgentIO.HistoryBytes), cancellation); if (!response.IsSuccess) return Result<IReadOnlyList<string>>.Fail(response.Error); var parsed = InvitationSynchronization.Apply(response.Value, self, state); if (!parsed.IsSuccess) return Result<IReadOnlyList<string>>.Fail(parsed.Error); state = parsed.Value; return Result<IReadOnlyList<string>>.Success(state.Senders.Keys.Order(StringComparer.Ordinal).ToArray());
    }
}
