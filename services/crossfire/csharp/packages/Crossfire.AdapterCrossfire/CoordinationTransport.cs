using Crossfire.Domain;
using Crossfire.AdapterHttp;
using Crossfire.AgentCore;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.AdapterCrossfire;

public static class CoordinationTransport
{
    public static Coordination Create(HttpClient http, string origin, string? token)
    { var client = new OperationClient(http, origin, () => token, RestOperations.All); return new(origin, client.Call); }
}
