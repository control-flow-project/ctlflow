using Crossfire.Contracts;

namespace Fleetd.Contracts;

public static class DaemonOperations
{
    public static readonly IReadOnlyDictionary<string, RestOperation> All = new Dictionary<string, RestOperation>(StringComparer.Ordinal)
    {
        ["setup"] = new("setup", "POST", "/api/setup", "public", 200, false, 1048576, false),
        ["status"] = new("status", "GET", "/api/status", "public", 200, false, 1048576, false),
        ["fleets"] = new("fleets", "GET", "/api/fleets", "public", 200, true, 1048576, false),
        ["addFleet"] = new("addFleet", "POST", "/api/fleets", "public", 201, false, 1048576, false),
        ["fleet"] = new("fleet", "GET", "/api/fleets/{fleetId}", "public", 200, false, 1048576, false),
        ["readiness"] = new("readiness", "GET", "/api/fleets/{fleetId}/readiness", "public", 200, false, 1048576, false),
        ["changeFleet"] = new("changeFleet", "PATCH", "/api/fleets/{fleetId}", "public", 200, false, 1048576, false),
        ["removeFleet"] = new("removeFleet", "DELETE", "/api/fleets/{fleetId}", "public", 200, false, 1048576, false),
        ["changeFleetDelivery"] = new("changeFleetDelivery", "PUT", "/api/fleets/{fleetId}/delivery", "public", 200, false, 1048576, false),
        ["createFleetMessage"] = new("createFleetMessage", "POST", "/api/fleets/{fleetId}/messages", "public", 201, false, 1048576, false),
        ["agents"] = new("agents", "GET", "/api/fleets/{fleetId}/agents", "public", 200, true, 1048576, false),
        ["addAgent"] = new("addAgent", "POST", "/api/fleets/{fleetId}/agents", "public", 201, false, 1048576, false),
        ["agent"] = new("agent", "GET", "/api/fleets/{fleetId}/agents/{instanceKey}", "public", 200, false, 1048576, false),
        ["contexts"] = new("contexts", "GET", "/api/fleets/{fleetId}/agents/{instanceKey}/contexts", "public", 200, false, 1048576, false),
        ["attachment"] = new("attachment", "GET", "/api/fleets/{fleetId}/agents/{instanceKey}/attachment", "public", 200, false, 1048576, false),
        ["changeAgent"] = new("changeAgent", "PATCH", "/api/fleets/{fleetId}/agents/{instanceKey}", "public", 200, false, 1048576, false),
        ["removeAgent"] = new("removeAgent", "DELETE", "/api/fleets/{fleetId}/agents/{instanceKey}", "public", 200, false, 1048576, false),
        ["operate"] = new("operate", "POST", "/api/operations", "public", 202, false, 1048576, false),
        ["operation"] = new("operation", "GET", "/api/operations/{operationId}", "public", 200, false, 1048576, false),
    };
}
