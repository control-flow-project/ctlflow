using Crossfire.Contracts;

namespace Fleetd.Contracts;

public static class DaemonOperations
{
    public static readonly IReadOnlyDictionary<string, RestOperation> All = new Dictionary<string, RestOperation>(StringComparer.Ordinal)
    {
        ["diagnostics"] = new("diagnostics", "GET", "/api/diagnostics", "controller", 200, false, 1048576, false),
        ["setup"] = new("setup", "POST", "/api/setup", "controller", 200, false, 1048576, false),
        ["status"] = new("status", "GET", "/api/status", "controller", 200, false, 1048576, false),
        ["fleets"] = new("fleets", "GET", "/api/fleets", "controller", 200, true, 1048576, false),
        ["addFleet"] = new("addFleet", "POST", "/api/fleets", "controller", 201, false, 1048576, false),
        ["fleet"] = new("fleet", "GET", "/api/fleets/{fleetId}", "controller", 200, false, 1048576, false),
        ["readiness"] = new("readiness", "GET", "/api/fleets/{fleetId}/readiness", "controller", 200, false, 1048576, false),
        ["changeFleet"] = new("changeFleet", "PATCH", "/api/fleets/{fleetId}", "controller", 200, false, 1048576, false),
        ["removeFleet"] = new("removeFleet", "DELETE", "/api/fleets/{fleetId}", "controller", 200, false, 1048576, false),
        ["changeFleetDelivery"] = new("changeFleetDelivery", "PUT", "/api/fleets/{fleetId}/delivery", "controller", 200, false, 1048576, false),
        ["createFleetMessage"] = new("createFleetMessage", "POST", "/api/fleets/{fleetId}/messages", "controller", 201, false, 1048576, false),
        ["agents"] = new("agents", "GET", "/api/fleets/{fleetId}/agents", "controller", 200, true, 1048576, false),
        ["addAgent"] = new("addAgent", "POST", "/api/fleets/{fleetId}/agents", "controller", 201, false, 1048576, false),
        ["agent"] = new("agent", "GET", "/api/fleets/{fleetId}/agents/{instanceKey}", "controller", 200, false, 1048576, false),
        ["contexts"] = new("contexts", "GET", "/api/fleets/{fleetId}/agents/{instanceKey}/contexts", "controller", 200, false, 1048576, false),
        ["attachment"] = new("attachment", "GET", "/api/fleets/{fleetId}/agents/{instanceKey}/attachment", "controller", 200, false, 1048576, false),
        ["changeAgent"] = new("changeAgent", "PATCH", "/api/fleets/{fleetId}/agents/{instanceKey}", "controller", 200, false, 1048576, false),
        ["removeAgent"] = new("removeAgent", "DELETE", "/api/fleets/{fleetId}/agents/{instanceKey}", "controller", 200, false, 1048576, false),
        ["operate"] = new("operate", "POST", "/api/operations", "controller", 202, false, 1048576, false),
        ["operation"] = new("operation", "GET", "/api/operations/{operationId}", "controller", 200, false, 1048576, false),
    };
}
