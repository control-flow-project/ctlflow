using System.Globalization;
using System.Text;
using Crossfire.Kernel;

namespace Crossfire.Domain;

public static class RoomPlanDigest
{
    private static string Number(long? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "null";
    private static string Boolean(bool value) => value ? "true" : "false";
    public static string Snapshots(IReadOnlyList<AgentGrantSnapshot> values)
    {
        var output = new StringBuilder("["); var index = 0;
        foreach (var value in values)
        {
            if (index++ != 0) output.Append(',');
            output.Append("{\"agentId\":").Append(ProtocolJson.Quote(value.AgentId)).Append(",\"revision\":").Append(Number(value.Revision)).Append(",\"grants\":["); var grantIndex = 0;
            foreach (var grant in value.Grants)
            {
                if (grantIndex++ != 0) output.Append(',');
                output.Append("{\"roomId\":").Append(ProtocolJson.Quote(grant.RoomId)).Append(",\"generation\":").Append(ProtocolJson.Quote(grant.Generation)).Append(",\"revision\":").Append(Number(grant.Revision)).Append('}');
            }
            output.Append("]}");
        }
        return output.Append(']').ToString();
    }

    public static string Digest(string fleetId, long revision, IReadOnlyList<AgentGrantSnapshot> snapshots, IReadOnlyList<PlannedChange> changes)
    {
        var output = new StringBuilder("{\"fleetId\":").Append(ProtocolJson.Quote(fleetId)).Append(",\"fleetRevision\":").Append(Number(revision)).Append(",\"snapshots\":").Append(Snapshots(snapshots)).Append(",\"changes\":["); var index = 0;
        foreach (var change in changes)
        {
            if (index++ != 0) output.Append(','); var proof = change.Proof; var input = proof.Input;
            output.Append("{\"input\":{");
            if (input.AccessMode != "none") output.Append("\"roomId\":").Append(ProtocolJson.Quote(input.RoomId)).Append(',');
            output.Append("\"accessMode\":").Append(ProtocolJson.Quote(input.AccessMode)).Append(",\"powerLevel\":").Append(Number(input.PowerLevel)).Append(",\"muted\":").Append(Boolean(input.Muted)).Append(",\"agentId\":").Append(ProtocolJson.Quote(input.AgentId));
            if (input.AccessMode == "none") output.Append(",\"roomId\":").Append(ProtocolJson.Quote(input.RoomId));
            output.Append(",\"expectedRevision\":").Append(Number(input.ExpectedRevision)).Append(",\"expectedGeneration\":").Append(input.ExpectedGeneration is null ? "null" : ProtocolJson.Quote(input.ExpectedGeneration)).Append("},\"authorizerId\":").Append(ProtocolJson.Quote(proof.AuthorizerId)).Append(",\"native\":");
            if (proof.Native is not { } native) output.Append("null");
            else output.Append("{\"powerLevel\":").Append(Number(native.PowerLevel)).Append(",\"creator\":").Append(Boolean(native.Creator)).Append(",\"readLevel\":").Append(Number(native.ReadLevel)).Append(",\"replyLevel\":").Append(Number(native.ReplyLevel)).Append('}');
            output.Append('}');
        }
        return Identity.Hash(output.Append("]}").ToString());
    }
}
