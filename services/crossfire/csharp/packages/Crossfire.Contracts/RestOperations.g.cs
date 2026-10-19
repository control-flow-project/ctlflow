#nullable enable
using System.Text.Json;

namespace Crossfire.Contracts;

public sealed record RestOperation(string Name, string Method, string Path, string Authentication, int Status, bool Collection, int MaximumBodyBytes, bool Binary);

public sealed record RestCall(string Operation, IReadOnlyDictionary<string, string> Parameters, JsonElement? Body = null, IReadOnlyDictionary<string, string>? Query = null);

public static class RestOperations
{
    public static readonly IReadOnlyDictionary<string, RestOperation> All = new Dictionary<string, RestOperation>(StringComparer.Ordinal)
    {
        ["messagingBackend"] = new("messagingBackend", "GET", "/api/messaging-backend", "public", 200, false, 2097152, false),
        ["authenticateBackend"] = new("authenticateBackend", "POST", "/api/backend-authentication", "public", 200, false, 2097152, false),
        ["recordFleetNativeStop"] = new("recordFleetNativeStop", "PUT", "/api/fleets/{fleetId}/agents/{agentId}/native-stop", "fleet", 200, false, 2097152, false),
        ["createPublication"] = new("createPublication", "POST", "/api/publications", "agent", 201, false, 2097152, false),
        ["publications"] = new("publications", "GET", "/api/publications", "human", 200, true, 2097152, false),
        ["publication"] = new("publication", "GET", "/api/publications/{publicationId}", "either", 200, false, 2097152, false),
        ["uploadPublicationFile"] = new("uploadPublicationFile", "PUT", "/api/publications/{publicationId}/files/{fileId}", "agent", 200, false, 8388608, true),
        ["commitPublication"] = new("commitPublication", "PUT", "/api/publications/{publicationId}/commit", "agent", 200, false, 2097152, false),
        ["deletePublication"] = new("deletePublication", "DELETE", "/api/publications/{publicationId}", "human", 200, false, 2097152, false),
        ["fleetRuntimeOperations"] = new("fleetRuntimeOperations", "GET", "/api/fleets/{fleetId}/session-operations", "either", 200, true, 2097152, false),
        ["requestFleetRuntime"] = new("requestFleetRuntime", "POST", "/api/fleets/{fleetId}/session-operations", "human", 202, false, 2097152, false),
        ["claimFleetRuntime"] = new("claimFleetRuntime", "PUT", "/api/fleets/{fleetId}/session-operations/{operationId}/claim", "fleet", 200, false, 2097152, false),
        ["receiptFleetRuntime"] = new("receiptFleetRuntime", "PUT", "/api/fleets/{fleetId}/session-operations/{operationId}/receipt", "fleet", 200, false, 2097152, false),
        ["runtimeObservations"] = new("runtimeObservations", "GET", "/api/agents/{agentId}/runtime-observations", "either", 200, false, 2097152, false),
        ["reportRuntime"] = new("reportRuntime", "PUT", "/api/agents/{agentId}/listener-runs/{runId}/runtime", "agent", 200, false, 2097152, false),
        ["runtimeDecisions"] = new("runtimeDecisions", "GET", "/api/agents/{agentId}/runtime-decisions", "either", 200, true, 2097152, false),
        ["createRuntimeDecision"] = new("createRuntimeDecision", "POST", "/api/agents/{agentId}/runtime-decisions", "agent", 201, false, 16777216, false),
        ["runtimeDecision"] = new("runtimeDecision", "GET", "/api/agents/{agentId}/runtime-decisions/{decisionId}", "either", 200, false, 2097152, false),
        ["answerRuntimeDecision"] = new("answerRuntimeDecision", "POST", "/api/agents/{agentId}/runtime-decisions/{decisionId}/answer", "human", 200, false, 2097152, false),
        ["pollRuntimeDecision"] = new("pollRuntimeDecision", "GET", "/api/agents/{agentId}/runtime-decisions/{decisionId}/answer", "agent", 200, false, 2097152, false),
        ["receiptRuntimeDecision"] = new("receiptRuntimeDecision", "PUT", "/api/agents/{agentId}/runtime-decisions/{decisionId}/receipt", "agent", 200, false, 2097152, false),
        ["reportFleetFailure"] = new("reportFleetFailure", "POST", "/api/fleets/{fleetId}/runtime-incidents", "fleet", 201, false, 2097152, false),
        ["wakeRules"] = new("wakeRules", "GET", "/api/wake-rules", "human", 200, true, 2097152, false),
        ["createWakeRule"] = new("createWakeRule", "POST", "/api/wake-rules", "human", 201, false, 2097152, false),
        ["wakeRule"] = new("wakeRule", "GET", "/api/wake-rules/{ruleId}", "human", 200, false, 2097152, false),
        ["changeWakeRule"] = new("changeWakeRule", "PUT", "/api/wake-rules/{ruleId}", "human", 200, false, 2097152, false),
        ["deleteWakeRule"] = new("deleteWakeRule", "DELETE", "/api/wake-rules/{ruleId}", "human", 200, false, 2097152, false),
        ["wakeMetadata"] = new("wakeMetadata", "GET", "/api/agents/{agentId}/wake-deliveries", "agent", 200, false, 2097152, false),
        ["claimWake"] = new("claimWake", "POST", "/api/agents/{agentId}/wake-deliveries", "agent", 200, false, 2097152, false),
        ["validateWake"] = new("validateWake", "GET", "/api/agents/{agentId}/wake-deliveries/{deliveryId}", "agent", 200, false, 2097152, false),
        ["acknowledgeWake"] = new("acknowledgeWake", "PUT", "/api/agents/{agentId}/wake-deliveries/{deliveryId}/receipt", "agent", 200, false, 2097152, false),
        ["createSession"] = new("createSession", "POST", "/api/sessions", "public", 201, false, 2097152, false),
        ["currentSession"] = new("currentSession", "GET", "/api/sessions/current", "human", 200, false, 2097152, false),
        ["endSession"] = new("endSession", "DELETE", "/api/sessions/current", "human", 200, false, 2097152, false),
        ["principals"] = new("principals", "GET", "/api/principals", "either", 200, true, 2097152, false),
        ["resolvePrincipals"] = new("resolvePrincipals", "POST", "/api/principal-resolutions", "either", 200, false, 2097152, false),
        ["roles"] = new("roles", "GET", "/api/roles", "either", 200, false, 2097152, false),
        ["permissions"] = new("permissions", "GET", "/api/permissions", "either", 200, false, 2097152, false),
        ["members"] = new("members", "GET", "/api/members", "human", 200, true, 2097152, false),
        ["member"] = new("member", "GET", "/api/members/{memberId}", "human", 200, false, 2097152, false),
        ["changeMember"] = new("changeMember", "PATCH", "/api/members/{memberId}", "human", 202, false, 2097152, false),
        ["memberRole"] = new("memberRole", "PUT", "/api/members/{memberId}/role", "human", 200, false, 2097152, false),
        ["createInvitation"] = new("createInvitation", "POST", "/api/member-invitations", "human", 201, false, 2097152, false),
        ["invitations"] = new("invitations", "GET", "/api/member-invitations", "human", 200, true, 2097152, false),
        ["invitation"] = new("invitation", "GET", "/api/member-invitations/{invitationId}", "human", 200, false, 2097152, false),
        ["revokeInvitation"] = new("revokeInvitation", "DELETE", "/api/member-invitations/{invitationId}", "human", 202, false, 2097152, false),
        ["claimInvitation"] = new("claimInvitation", "POST", "/api/member-invitations/{invitationId}/claim", "public", 200, false, 2097152, false),
        ["registrationPolicy"] = new("registrationPolicy", "GET", "/api/registration-policy", "public", 200, false, 2097152, false),
        ["preflight"] = new("preflight", "POST", "/api/enrollments/preflight", "public", 200, false, 2097152, false),
        ["introduceEnrollment"] = new("introduceEnrollment", "POST", "/api/enrollments", "public", 201, false, 2097152, false),
        ["enrollments"] = new("enrollments", "GET", "/api/enrollments", "human", 200, true, 2097152, false),
        ["enrollment"] = new("enrollment", "GET", "/api/enrollments/{enrollmentId}", "human", 200, false, 2097152, false),
        ["decideEnrollment"] = new("decideEnrollment", "POST", "/api/enrollments/{enrollmentId}/decision", "human", 202, false, 2097152, false),
        ["exchangeEnrollment"] = new("exchangeEnrollment", "POST", "/api/enrollments/{enrollmentId}/exchange", "public", 200, false, 2097152, false),
        ["fleets"] = new("fleets", "GET", "/api/fleets", "human", 200, true, 2097152, false),
        ["fleet"] = new("fleet", "GET", "/api/fleets/{fleetId}", "fleet", 200, false, 2097152, false),
        ["changeFleet"] = new("changeFleet", "PATCH", "/api/fleets/{fleetId}", "fleet", 200, false, 2097152, false),
        ["archiveFleet"] = new("archiveFleet", "POST", "/api/fleets/{fleetId}/archive", "fleet", 200, false, 2097152, false),
        ["fleetMap"] = new("fleetMap", "GET", "/api/fleets/{fleetId}/map", "human", 200, false, 2097152, false),
        ["fleetStatistics"] = new("fleetStatistics", "GET", "/api/fleets/{fleetId}/statistics", "human", 200, false, 2097152, false),
        ["fleetAgents"] = new("fleetAgents", "GET", "/api/fleets/{fleetId}/agents", "fleet", 200, true, 2097152, false),
        ["changeFleetDelivery"] = new("changeFleetDelivery", "PUT", "/api/fleets/{fleetId}/delivery", "fleet", 200, false, 2097152, false),
        ["reportFleetConnection"] = new("reportFleetConnection", "PUT", "/api/fleets/{fleetId}/controller-connections/{connectionId}", "fleet", 200, false, 2097152, false),
        ["fleetControl"] = new("fleetControl", "GET", "/api/fleets/{fleetId}/control", "fleet", 200, false, 2097152, false),
        ["fleetMessages"] = new("fleetMessages", "GET", "/api/fleets/{fleetId}/messages", "fleet", 200, true, 2097152, false),
        ["createFleetMessage"] = new("createFleetMessage", "POST", "/api/fleets/{fleetId}/messages", "fleet", 201, false, 2097152, false),
        ["acknowledgeFleetMessage"] = new("acknowledgeFleetMessage", "PUT", "/api/fleets/{fleetId}/messages/{messageId}/deliveries/{agentId}", "fleet", 200, false, 2097152, false),
        ["removeFleetAgent"] = new("removeFleetAgent", "DELETE", "/api/fleets/{fleetId}/agents/{agentId}", "fleet", 200, false, 2097152, false),
        ["agents"] = new("agents", "GET", "/api/agents", "human", 200, true, 2097152, false),
        ["agent"] = new("agent", "GET", "/api/agents/{agentId}", "either", 200, false, 2097152, false),
        ["changeAgent"] = new("changeAgent", "PATCH", "/api/agents/{agentId}", "human", 202, false, 2097152, false),
        ["wakePolicy"] = new("wakePolicy", "GET", "/api/agents/{agentId}/wake-policy", "either", 200, false, 2097152, false),
        ["changeWakePolicy"] = new("changeWakePolicy", "PUT", "/api/agents/{agentId}/wake-policy", "human", 200, false, 2097152, false),
        ["deliveryPolicy"] = new("deliveryPolicy", "GET", "/api/agents/{agentId}/delivery-policy", "agent", 200, false, 2097152, false),
        ["rooms"] = new("rooms", "GET", "/api/rooms", "human", 200, true, 2097152, false),
        ["room"] = new("room", "GET", "/api/rooms/{roomId}", "human", 200, false, 2097152, false),
        ["grants"] = new("grants", "GET", "/api/agents/{agentId}/room-grants", "either", 200, true, 2097152, false),
        ["grant"] = new("grant", "GET", "/api/agents/{agentId}/room-grants/{roomId}", "either", 200, false, 2097152, false),
        ["setGrant"] = new("setGrant", "PUT", "/api/agents/{agentId}/room-grants/{roomId}", "either", 202, false, 2097152, false),
        ["removeGrant"] = new("removeGrant", "DELETE", "/api/agents/{agentId}/room-grants/{roomId}", "either", 202, false, 2097152, false),
        ["grantPermissions"] = new("grantPermissions", "GET", "/api/agents/{agentId}/room-grants/{roomId}/permissions", "human", 200, false, 2097152, false),
        ["acceptRoomInvitation"] = new("acceptRoomInvitation", "POST", "/api/agents/{agentId}/room-invitation-acceptances", "agent", 200, false, 2097152, false),
        ["ownerConversation"] = new("ownerConversation", "POST", "/api/agents/{agentId}/owner-conversation", "agent", 200, false, 2097152, false),
        ["setGrantPermissions"] = new("setGrantPermissions", "PUT", "/api/agents/{agentId}/room-grants/{roomId}/permissions", "human", 202, false, 2097152, false),
        ["previewGrants"] = new("previewGrants", "POST", "/api/room-grant-previews", "human", 200, false, 2097152, false),
        ["applyGrants"] = new("applyGrants", "POST", "/api/room-grant-changes", "human", 202, false, 2097152, false),
        ["listenerRuns"] = new("listenerRuns", "GET", "/api/agents/{agentId}/listener-runs", "either", 200, true, 2097152, false),
        ["reportListener"] = new("reportListener", "PUT", "/api/agents/{agentId}/listener-runs/{runId}", "agent", 200, false, 2097152, false),
        ["wakeNotice"] = new("wakeNotice", "PUT", "/api/agents/{agentId}/wake-notices/{eventId}", "agent", 202, false, 2097152, false),
        ["policy"] = new("policy", "GET", "/api/instance-policy", "human", 200, false, 2097152, false),
        ["changePolicy"] = new("changePolicy", "PATCH", "/api/instance-policy", "human", 200, false, 2097152, false),
        ["audit"] = new("audit", "GET", "/api/audit-events", "human", 200, true, 2097152, false),
        ["release"] = new("release", "GET", "/api/releases/current", "public", 200, false, 2097152, false),
        ["health"] = new("health", "GET", "/api/health", "public", 200, false, 2097152, false),
    };
}

public static class HttpLimits
{
    public const int RequestBytes = 2097152;
    public const int ResponseBytes = 33554432;
    public const int RequestMilliseconds = 30000;
    public const int PublicMutationsPerMinute = 120;
    public const int PublicMutationsGlobalPerMinute = 4096;
    public const int PublicMutationClients = 4096;
}
