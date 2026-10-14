using Crossfire.Kernel;
using System.Text.Json;
using Crossfire.Domain;

namespace Crossfire.Server.Http;

public static class DiscoveryViews
{
    public static void Principal(ProtocolWriter writer, PrincipalSummary value)
    {
        writer.WriteStartObject(); writer.WriteString("principalId", value.PrincipalId); writer.WriteString("matrixUserId", value.MatrixUserId); writer.WriteString("kind", value.Kind);
        writer.WriteString("displayName", value.DisplayName); writer.WriteString("ownerId", value.OwnerId); writer.WriteString("ownerMatrixId", value.OwnerMatrixId); writer.WriteEndObject();
    }
}
