using System.Net.Http.Headers;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.Server;
using Crossfire.Server.Http;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public sealed record HttpSample(string Operation, int Status, JsonElement Data);

public static class ServerAcceptance
{
    public static async Task Verify(AccountAuthority matrix, string database, string releaseDirectory, string owner, string ownerToken, string serverName, string matrixOrigin)
    {
        var configuration = new ServerConfiguration("fixture", serverName, "http://127.0.0.1", "http://localhost:8082", matrixOrigin, owner,
            "fixture-jwt", "fixture-registration", new(1073741824, 134217728, 4096, 128, 8), 7);
        var release = Releases.Load(releaseDirectory);
        using var reports = new PublicationStore(database + ".publications", configuration.PublicationBudget.Uploads, path => new StateLock(path));
        using var diagnostics = new DiagnosticStore(database + ".logs", configuration.LoggingRetentionDays, Identity.Now);
        var state = new ApiState(configuration, database, release, matrix, reports, diagnostics, Identity.Now(), Identity.Now);
        var wakeCount = 0;
        await using var application = ApiApplication.Build(state, "http://127.0.0.1:0", () => wakeCount++);
        await application.StartAsync();
        await using var contentApplication = ContentApplication.Build(state, "http://127.0.0.1:0");
        await contentApplication.StartAsync();
        using var client = NativeHttp.Client(); var baseUri = application.Urls.Single();
        var samples = new List<HttpSample>(); var cookieJar = new Dictionary<string, string>(StringComparer.Ordinal); string? csrf = null;
        Equal(ApiApplication.Endpoints().Select(endpoint => endpoint.OperationName).Order(StringComparer.Ordinal).SequenceEqual(RestOperations.All.Keys.Order(StringComparer.Ordinal)), true, "every canonical REST operation has exactly one C# handler");
        async Task<JsonElement> Request(string method, string path, string? operation, JsonElement? body = null, string? origin = "http://127.0.0.1", string? bearer = null, string? csrfOverride = null, int? failure = null, bool nativeOnly = false)
        {
            using var request = new HttpRequestMessage(new(method), baseUri + path);
            request.Headers.Host = "127.0.0.1";
            if (origin is not null) request.Headers.TryAddWithoutValidation("Origin", origin);
            if (cookieJar.Count != 0 && !nativeOnly) request.Headers.TryAddWithoutValidation("Cookie", string.Join("; ", cookieJar.Values));
            if (csrfOverride is not null || csrf is not null) request.Headers.TryAddWithoutValidation("X-Crossfire-CSRF", csrfOverride ?? csrf);
            if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            if (body is not null)
            {
                request.Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(body.Value, ApiJson.Default.JsonElement));
                request.Content.Headers.ContentType = new("application/json");
            }
            using var response = await client.SendAsync(request);
            using var document = JsonDocument.Parse(await response.Content.ReadAsByteArrayAsync());
            var value = document.RootElement;
            Equal(response.Headers.Contains("X-Request-ID"), true, "C# HTTP response has bounded request correlation");
            if (failure is not null)
            {
                Equal((int)response.StatusCode, failure.Value, "C# HTTP expected refusal " + path);
                return value.Clone();
            }
            Equal(response.IsSuccessStatusCode, true, "C# HTTP successful operation " + path + (response.IsSuccessStatusCode ? "" : ": " + value.GetRawText()));
            if (operation is not null) samples.Add(new(operation, (int)response.StatusCode, value.GetProperty("data").Clone()));
            if (response.Headers.TryGetValues("Set-Cookie", out var cookies))
            {
                foreach (var setting in cookies)
                {
                    Equal(setting.Contains("HttpOnly; SameSite=Strict; Secure", StringComparison.Ordinal), true, "management credential uses private host-only secure cookie");
                    Equal(setting.Contains("Domain=", StringComparison.OrdinalIgnoreCase), false, "management credential is never shared with the content hostname");
                    var cookie = setting.Split(';', 2)[0]; cookieJar[cookie.Split('=', 2)[0]] = cookie;
                }
            }
            return value.GetProperty("data").Clone();
        }
        await Request("GET", "/api/health", "health", origin: null);
        await Request("GET", "/api/releases/current", "release", origin: null);
        await Request("GET", "/api/health?unknown=1", null, failure: 400);
        await Request("GET", "/api/health", null, origin: "https://foreign.example", failure: 403);
        var empty = JsonValues.Object(_ => { });
        await Request("GET", "/api/sessions/current", null, failure: 401);
        var login = JsonValues.Object(writer => writer.WriteString("nativeAccessToken", ownerToken));
        await Request("POST", "/api/sessions", null, login, origin: null, failure: 403);
        var session = await Request("POST", "/api/sessions", "createSession", login);
        csrf = session.GetProperty("csrfSecret").GetString();
        Equal(session.GetRawText().Contains(ownerToken, StringComparison.Ordinal), false, "management session response never returns native credential");
        var memberId = session.GetProperty("member").GetProperty("memberId").GetString()!;
        await Request("GET", "/api/sessions/current", "currentSession");
        await Request("GET", "/api/members", "members");
        await Request("GET", "/api/members/" + memberId, "member");
        await Request("GET", "/api/principals", "principals");
        var resolved = await Request("POST", "/api/principal-resolutions", "resolvePrincipals", JsonValues.Object(writer => JsonValues.Strings(writer, "matrixUserIds", [owner, "@unknown:" + serverName])));
        Equal(resolved[1].GetProperty("kind").GetString(), "unknown", "unknown directory identities remain unknown, never inferred from a label");
        await Request("GET", "/api/roles", "roles");
        await Request("GET", "/api/permissions", "permissions");
        await Request("GET", "/api/principals?page=1&pageSize=10&kind=human", "principals");
        await Request("GET", "/api/principals?page=0b1&pageSize=10&kind=human", null, failure: 400);
        await Request("GET", "/api/principals?page=1&pageSize=0o12&kind=human", null, failure: 400);
        await Request("GET", "/api/principals?kind=unknown", null, failure: 400);
        await Request("GET", "/api/members?page=1&page=2", null, failure: 400);
        await Request("GET", "/api/sessions/current", null, bearer: ownerToken, failure: 400);
        var policy = await Request("GET", "/api/instance-policy", "policy");
        Equal(policy.GetProperty("maxMessageBytes").GetInt64(), 65536L, "HTTP exposes canonical large-message file threshold");
        var changePolicy = JsonValues.Object(writer =>
        {
            writer.WriteNumber("expectedRevision", policy.GetProperty("revision").GetInt64());
            foreach (var entry in policy.EnumerateObject().Where(entry => entry.Name != "revision")) entry.WriteTo(writer);
        });
        await Request("PATCH", "/api/instance-policy", null, changePolicy, csrfOverride: "invalid", failure: 403);
        await Request("PATCH", "/api/instance-policy", "changePolicy", changePolicy);
        var claim = Identity.Secret(); var enrollmentId = Identity.Identifier();
        var roster = JsonValues.Object(writer =>
        {
            writer.WriteStartObject("controller"); writer.WriteString("name", "HTTP controller"); writer.WriteEndObject();
            writer.WriteString("ownerMatrixId", owner); writer.WriteString("fleetKey", "http-fleet"); writer.WriteStartArray("instances");
            writer.WriteStartObject(); writer.WriteString("instanceKey", "http-specialist"); writer.WriteString("name", "http-specialist");
            writer.WriteStartObject("coordinationPolicy"); writer.WriteString("wakeMode", "selected"); writer.WriteStartArray("senders");
            writer.WriteStartObject(); writer.WriteString("matrixUserId", owner); writer.WriteBoolean("includeAgents", true); writer.WriteEndObject(); writer.WriteEndArray();
            JsonValues.Strings(writer, "permissions", ["room.agent.invite"]); writer.WriteEndObject(); writer.WriteEndObject(); writer.WriteEndArray();
        });
        await Request("POST", "/api/enrollments/preflight", "preflight", roster);
        var introduction = JsonValues.Object(writer =>
        {
            foreach (var entry in roster.EnumerateObject()) entry.WriteTo(writer);
            writer.WriteString("enrollmentId", enrollmentId); writer.WriteString("claimSecret", claim);
        });
        var review = await Request("POST", "/api/enrollments", "introduceEnrollment", introduction);
        Equal(review.GetRawText().Contains(claim, StringComparison.Ordinal), false, "enrollment review never exposes private initiating claim");
        var details = await Request("GET", "/api/enrollments/" + enrollmentId, "enrollment");
        await Request("GET", "/api/enrollments", "enrollments");
        var decision = JsonValues.Object(writer =>
        {
            writer.WriteNumber("expectedRevision", details.GetProperty("enrollment").GetProperty("revision").GetInt64()); writer.WriteString("decision", "approve");
            writer.WriteString("verificationCode", details.GetProperty("enrollment").GetProperty("verificationCode").GetString());
        });
        await Request("POST", "/api/enrollments/" + enrollmentId + "/decision", "decideEnrollment", decision);
        var exchanged = await Request("POST", "/api/enrollments/" + enrollmentId + "/exchange", "exchangeEnrollment", JsonValues.Object(writer => writer.WriteString("claimSecret", claim)));
        var agentId = exchanged.GetProperty("instances")[0].GetProperty("agentId").GetString()!;
        using (var context = new CrossfireDbContext(database))
            Equal((await PrincipalApplications.Reconcile(PrincipalApplicationCommands.Ports(context, Identity.Now, matrix.Ports(), matrix.RoomOperation), agentId)).IsSuccess, true, "HTTP fixture provisions an actual native agent");
        exchanged = await Request("POST", "/api/enrollments/" + enrollmentId + "/exchange", "exchangeEnrollment", JsonValues.Object(writer => writer.WriteString("claimSecret", claim)));
        var controller = exchanged.GetProperty("fleet").GetProperty("controllerCredential").GetString()!;
        var fleetId = exchanged.GetProperty("fleet").GetProperty("fleetId").GetString()!;
        var agentToken = exchanged.GetProperty("instances")[0].GetProperty("account").GetProperty("accessToken").GetString()!;
        var connectionId = Identity.Identifier();
        var connected = await Request("PUT", "/api/fleets/" + fleetId + "/controller-connections/" + connectionId, "reportFleetConnection", JsonValues.Object(writer => writer.WriteBoolean("stopped", false)), bearer: controller, nativeOnly: true);
        var revision = connected.GetProperty("revision").GetInt64();
        await Request("GET", "/api/fleets", "fleets");
        await Request("GET", "/api/fleets/" + fleetId, "fleet");
        await Request("GET", "/api/fleets/" + fleetId + "/agents", "fleetAgents");
        await Request("GET", "/api/agents", "agents");
        var agent = await Request("GET", "/api/agents/" + agentId, "agent");
        Equal(agent.GetProperty("deployment").GetProperty("fleetId").GetString(), fleetId, "HTTP directory provides exact current deployment identity");
        await Request("GET", "/api/agents/" + agentId + "/wake-policy", "wakePolicy");
        await Request("GET", "/api/agents/" + agentId + "/delivery-policy", "deliveryPolicy", bearer: agentToken, nativeOnly: true);
        agent = await Request("PATCH", "/api/agents/" + agentId, "changeAgent", JsonValues.Object(writer => writer.WriteNumber("expectedRevision", agent.GetProperty("revision").GetInt64())));
        await Request("PUT", "/api/agents/" + agentId + "/wake-policy", "changeWakePolicy", JsonValues.Object(writer =>
        {
            writer.WriteNumber("expectedRevision", agent.GetProperty("revision").GetInt64()); writer.WriteString("mode", "selected"); writer.WriteStartArray("senders");
            writer.WriteStartObject(); writer.WriteString("principalId", memberId); writer.WriteBoolean("includeAgents", true); writer.WriteEndObject(); writer.WriteEndArray();
        }));
        var ownerConversation = await Request("POST", "/api/agents/" + agentId + "/owner-conversation", "ownerConversation", empty, bearer: agentToken, nativeOnly: true);
        var ownerRoom = ownerConversation.GetProperty("roomId").GetString()!;
        await Request("GET", "/api/rooms", "rooms");
        await Request("GET", "/api/rooms/" + Uri.EscapeDataString(ownerRoom), "room");
        var nativeOwner = (await matrix.AsUser(owner)).Value;
        var createdRoom = await MatrixJson.Ok(client, nativeOwner, "POST", MatrixJson.Api + "/createRoom", JsonValues.Object(writer =>
        { writer.WriteString("preset", "public_chat"); writer.WriteString("name", "HTTP room authority"); }));
        Equal(createdRoom.IsSuccess, true, "HTTP room fixture creates an actual Matrix room");
        var roomId = createdRoom.Value.GetProperty("room_id").GetString()!;
        var grantPath = "/api/agents/" + agentId + "/room-grants/" + Uri.EscapeDataString(roomId);
        agent = await Request("GET", "/api/agents/" + agentId, "agent");
        var grant = await Request("PUT", grantPath, "setGrant", JsonValues.Object(writer =>
        {
            writer.WriteNumber("expectedRevision", agent.GetProperty("revision").GetInt64()); writer.WriteNull("expectedGeneration"); writer.WriteString("accessMode", "reply"); writer.WriteNull("powerLevel"); writer.WriteBoolean("muted", false);
        }));
        await Request("GET", "/api/agents/" + agentId + "/room-grants", "grants");
        var filteredGrants = await Request("GET", "/api/agents/" + agentId + "/room-grants?roomIds=%5B%5D", "grants");
        Equal(filteredGrants.GetArrayLength(), 0, "an empty room filter never broadens to every room");
        await Request("GET", grantPath, "grant");
        await Request("GET", grantPath + "/permissions", "grantPermissions");
        grant = await Request("PUT", grantPath + "/permissions", "setGrantPermissions", JsonValues.Object(writer =>
        {
            writer.WriteNumber("expectedRevision", grant.GetProperty("revision").GetInt64()); writer.WriteString("expectedGeneration", grant.GetProperty("grant").GetProperty("generation").GetString()); JsonValues.Strings(writer, "permissions", ["room.agent.invite"]);
        }));
        var protectedGrant = await Request("GET", "/api/agents/" + agentId + "/room-grants/" + Uri.EscapeDataString(ownerRoom), "grant");
        Equal(protectedGrant.GetProperty("ownerConversation").GetBoolean(), true, "owner observation room is protected in the HTTP contract");
        await Request("DELETE", "/api/agents/" + agentId + "/room-grants/" + Uri.EscapeDataString(ownerRoom), null, JsonValues.Object(writer =>
        { writer.WriteNumber("expectedRevision", grant.GetProperty("revision").GetInt64()); writer.WriteString("expectedGeneration", protectedGrant.GetProperty("grant").GetProperty("generation").GetString()); }), failure: 403);
        grant = await Request("DELETE", grantPath, "removeGrant", JsonValues.Object(writer =>
        { writer.WriteNumber("expectedRevision", grant.GetProperty("revision").GetInt64()); writer.WriteString("expectedGeneration", grant.GetProperty("grant").GetProperty("generation").GetString()); }));
        Equal(grant.GetProperty("permissions").GetArrayLength(), 0, "removal revokes membership-generation-scoped permissions");
        var invited = await MatrixJson.Ok(client, nativeOwner, "POST", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/invite", JsonValues.Object(writer => writer.WriteString("user_id", exchanged.GetProperty("instances")[0].GetProperty("account").GetProperty("matrixUserId").GetString())));
        Equal(invited.IsSuccess, true, "HTTP acceptance fixture uses an actual native invitation");
        var accepted = await Request("POST", "/api/agents/" + agentId + "/room-invitation-acceptances", "acceptRoomInvitation", JsonValues.Object(writer => writer.WriteString("roomId", roomId)), bearer: agentToken, nativeOnly: true);
        Equal(accepted.GetProperty("accepted").GetBoolean(), true, "HTTP invitation acceptance confirms actual Matrix membership");
        var roomPlan = JsonValues.Object(writer =>
        {
            writer.WriteString("fleetId", fleetId); writer.WriteStartArray("agents"); writer.WriteStartObject(); writer.WriteString("instanceKey", "http-specialist"); writer.WriteStartArray("grants");
            writer.WriteStartObject(); writer.WriteString("roomId", roomId); writer.WriteString("accessMode", "read"); writer.WriteNull("powerLevel"); writer.WriteBoolean("muted", false); writer.WriteEndObject(); writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndArray();
        });
        var reviewedPlan = await Request("POST", "/api/room-grant-previews", "previewGrants", JsonValues.Object(writer => { writer.WritePropertyName("plan"); roomPlan.WriteTo(writer); }));
        var applyPlan = JsonValues.Object(writer =>
        {
            writer.WritePropertyName("plan"); roomPlan.WriteTo(writer); writer.WriteString("digest", reviewedPlan.GetProperty("digest").GetString()); writer.WritePropertyName("snapshots"); reviewedPlan.GetProperty("snapshots").WriteTo(writer);
        });
        await Request("POST", "/api/room-grant-changes", "applyGrants", applyPlan);
        await Request("POST", "/api/room-grant-changes", null, applyPlan, failure: 409);
        await Request("GET", "/api/fleets/" + fleetId + "/control?connectionId=" + connectionId + "&revision=" + revision + "&waitMs=0", "fleetControl", bearer: controller, nativeOnly: true);
        await Request("GET", "/api/fleets/" + fleetId + "/control?connectionId=" + connectionId + "&revision=00&waitMs=0", null, bearer: controller, failure: 400, nativeOnly: true);
        var runId = Identity.Identifier();
        JsonElement Heartbeat(bool stopped, bool withStatistics) => JsonValues.Object(writer =>
        {
            writer.WriteString("release", release.Identity); writer.WriteNumber("messagesDelivered", 2); writer.WriteBoolean("stopped", stopped);
            writer.WriteStartObject("controller"); writer.WriteString("fleetId", fleetId); writer.WriteString("connectionId", connectionId); writer.WriteString("credential", controller); writer.WriteEndObject();
            if (!withStatistics) writer.WriteNull("statistics");
            else
            {
                writer.WriteStartObject("statistics"); writer.WriteNumber("sequence", 1); writer.WriteNumber("startedAt", Identity.Now() - 1000); writer.WriteNumber("endedAt", Identity.Now()); writer.WriteNumber("dropped", 0);
                writer.WriteStartArray("flows"); writer.WriteStartObject(); writer.WriteString("roomId", "!http-fixture:" + serverName); writer.WriteString("senderMatrixId", owner); writer.WriteString("messageType", "m.text");
                writer.WriteNumber("observed", 2); writer.WriteNumber("delivered", 2); writer.WriteNumber("contentBytes", 100); writer.WriteNumber("deliveredBytes", 100); writer.WriteNumber("attachmentBytes", 0); writer.WriteNumber("largestBytes", 70); writer.WriteEndObject(); writer.WriteEndArray();
                writer.WriteStartArray("usage"); writer.WriteStartObject(); writer.WriteString("runtime", "codex"); writer.WriteString("sessionId", "http-native-history"); writer.WriteStartObject("tokens");
                writer.WriteNumber("input", 100); writer.WriteNumber("cachedInput", 20); writer.WriteNull("cacheWriteInput"); writer.WriteNumber("output", 10); writer.WriteNumber("reasoningOutput", 5); writer.WriteNumber("total", 110);
                writer.WriteEndObject(); writer.WriteEndObject(); writer.WriteEndArray(); writer.WriteEndObject();
            }
        });
        var report = await Request("PUT", "/api/agents/" + agentId + "/listener-runs/" + runId, "reportListener", Heartbeat(false, true), bearer: agentToken, nativeOnly: true);
        Equal(report.GetProperty("statisticsAccepted").GetBoolean(), true, "native traffic and usage summary is accepted independently of listener heartbeat");
        grant = await Request("GET", grantPath, "grant");
        grant = await Request("PUT", grantPath, "setGrant", JsonValues.Object(writer =>
        { writer.WriteNumber("expectedRevision", grant.GetProperty("revision").GetInt64()); writer.WriteString("expectedGeneration", grant.GetProperty("grant").GetProperty("generation").GetString()); writer.WriteString("accessMode", "reply"); writer.WriteNull("powerLevel"); writer.WriteBoolean("muted", false); }));
        await Request("PUT", "/api/agents/" + agentId + "/wake-policy", "changeWakePolicy", JsonValues.Object(writer =>
        { writer.WriteNumber("expectedRevision", grant.GetProperty("revision").GetInt64()); writer.WriteString("mode", "selected"); writer.WriteStartArray("senders"); writer.WriteEndArray(); }));
        var agentMatrixId = exchanged.GetProperty("instances")[0].GetProperty("account").GetProperty("matrixUserId").GetString()!;
        async Task<string> Mention()
        {
            var sent = await MatrixJson.Ok(client, nativeOwner, "PUT", MatrixJson.Api + "/rooms/" + MatrixJson.Segment(roomId) + "/send/m.room.message/" + Identity.Identifier(), JsonValues.Object(writer =>
            { writer.WriteString("msgtype", "m.text"); writer.WriteString("body", "Please review this report."); writer.WriteStartObject("m.mentions"); JsonValues.Strings(writer, "user_ids", [agentMatrixId]); writer.WriteEndObject(); }));
            Equal(sent.IsSuccess, true, "blocked-mention fixture uses actual Matrix metadata"); return sent.Value.GetProperty("event_id").GetString()!;
        }
        var mentionedEvent = await Mention(); var noticePath = "/api/agents/" + agentId + "/wake-notices/" + Uri.EscapeDataString(mentionedEvent); var noticeBody = JsonValues.Object(writer => writer.WriteString("roomId", roomId));
        var blocked = await Request("PUT", noticePath, "wakeNotice", noticeBody, bearer: agentToken, nativeOnly: true);
        Equal(blocked.GetProperty("outcome").GetString(), "pending", "blocked source gets an ordinary-code queued notice instead of a model turn");
        using (var noticeDatabase = new CrossfireDbContext(database))
        {
            var ports = WakeNoticeQueries.Ports(noticeDatabase, Identity.Now, matrix.Ports());
            Equal((await WakeNotices.Publish(ports, agentId, mentionedEvent)).IsSuccess, true, "native blocked notice is published through the same Matrix authority");
            Equal(ports.Find(agentId, mentionedEvent).Value?.Status, "sent", "native publication owns the sent state");
        }
        Equal((await Request("PUT", noticePath, "wakeNotice", noticeBody, bearer: agentToken, nativeOnly: true)).GetProperty("outcome").GetString(), "sent", "notice event retries retain the native outcome");
        var subsequent = await Mention();
        Equal((await Request("PUT", "/api/agents/" + agentId + "/wake-notices/" + Uri.EscapeDataString(subsequent), "wakeNotice", noticeBody, bearer: agentToken, nativeOnly: true)).GetProperty("outcome").GetString(), "rate-limited", "blocked-notice cooldown prevents loops and message amplification");
        var map = await Request("GET", "/api/fleets/" + fleetId + "/map", "fleetMap");
        Equal(map.GetProperty("agents").GetArrayLength(), 1, "fleet map includes precisely its current agent bindings");
        var reportText = "<!doctype html><title>HTTP report</title><script>document.body.dataset.report='ready';</script><p>Reviewed report</p>";
        var reportBytes = System.Text.Encoding.UTF8.GetBytes(reportText);
        var publication = await Request("POST", "/api/publications", "createPublication", JsonValues.Object(writer =>
        {
            writer.WriteString("title", "HTTP report"); writer.WriteStartArray("files"); writer.WriteStartObject(); writer.WriteString("path", "index.html"); writer.WriteString("mediaType", "text/html"); writer.WriteNumber("bytes", reportBytes.Length);
            writer.WriteString("sha256", Identity.Hash(reportText)); writer.WriteEndObject(); writer.WriteEndArray();
        }), bearer: agentToken, nativeOnly: true);
        var publicationId = publication.GetProperty("id").GetString()!; var publicationFile = publication.GetProperty("files")[0].GetProperty("id").GetString()!;
        await Request("GET", "/api/publications", "publications");
        await Request("GET", "/api/publications/" + publicationId, "publication");
        using (var upload = new HttpRequestMessage(HttpMethod.Put, baseUri + "/api/publications/" + publicationId + "/files/" + publicationFile))
        {
            upload.Headers.Host = "127.0.0.1"; upload.Headers.Authorization = new("Bearer", agentToken); upload.Content = new ByteArrayContent(reportBytes); upload.Content.Headers.ContentType = new("application/octet-stream");
            using var uploaded = await client.SendAsync(upload); using var document = JsonDocument.Parse(await uploaded.Content.ReadAsByteArrayAsync());
            Equal((int)uploaded.StatusCode, 200, "actual HTTP binary upload is streamed and authenticated"); samples.Add(new("uploadPublicationFile", 200, document.RootElement.GetProperty("data").Clone()));
        }
        publication = await Request("PUT", "/api/publications/" + publicationId + "/commit", "commitPublication", JsonValues.Object(writer => writer.WriteNumber("expectedRevision", 0)), bearer: agentToken, nativeOnly: true);
        var publicPath = new Uri(publication.GetProperty("url").GetString()!).AbsolutePath;
        async Task Content(int expected, string host = "localhost:8082", string method = "GET")
        {
            using var request = new HttpRequestMessage(new(method), contentApplication.Urls.Single() + publicPath); request.Headers.Host = host;
            request.Headers.TryAddWithoutValidation("Cookie", "__Host-crossfire=must-not-grant-content-authority");
            using var response = await client.SendAsync(request); Equal((int)response.StatusCode, expected, "isolated report origin " + method + "/" + host);
            Equal(response.Headers.Contains("Set-Cookie"), false, "content origin never sets management or Matrix cookies");
            Equal(response.Headers.GetValues("Content-Security-Policy").Single(), ContentApplication.SecurityPolicy, "content script execution remains in an opaque sandbox");
            if (expected == 200 && method == "GET") Equal(await response.Content.ReadAsStringAsync(), reportText, "public report bytes match the committed manifest");
        }
        await Content(200); await Content(200, method: "HEAD"); await Content(204, method: "OPTIONS"); await Content(421, "foreign.example"); await Content(405, method: "POST");
        await Request("DELETE", "/api/publications/" + publicationId, "deletePublication", JsonValues.Object(writer => writer.WriteNumber("expectedRevision", 1)));
        await Content(404);
        await Request("GET", "/api/agents/" + agentId + "/listener-runs", "listenerRuns");
        var wakeRuleId = Identity.Identifier();
        JsonElement WakeConfiguration(bool create, bool enabled) => JsonValues.Object(writer =>
        {
            if (create) writer.WriteString("ruleId", wakeRuleId); else writer.WriteNumber("expectedRevision", 0);
            writer.WriteString("name", "HTTP scheduled check"); writer.WriteString("message", "Review the new report."); writer.WriteStartObject("schedule"); writer.WriteString("kind", "interval"); writer.WriteNumber("seconds", 3600); writer.WriteEndObject();
            writer.WriteBoolean("enabled", enabled); JsonValues.Strings(writer, "agentIds", [agentId]);
        });
        await Request("POST", "/api/wake-rules", "createWakeRule", WakeConfiguration(true, true));
        await Request("GET", "/api/wake-rules", "wakeRules");
        await Request("GET", "/api/wake-rules/" + wakeRuleId, "wakeRule");
        var wakePath = "/api/agents/" + agentId + "/wake-deliveries";
        var wakeAttachment = JsonValues.Object(writer => { writer.WriteString("runId", runId); writer.WriteString("sessionId", "http-native-history"); });
        var wakeQuery = "?runId=" + runId + "&sessionId=http-native-history";
        await Request("GET", wakePath + wakeQuery, "wakeMetadata", bearer: agentToken, nativeOnly: true);
        await Request("POST", wakePath, "claimWake", wakeAttachment, bearer: agentToken, nativeOnly: true);
        var missingWake = Identity.Identifier();
        await Request("GET", wakePath + "/" + missingWake + wakeQuery, "validateWake", bearer: agentToken, nativeOnly: true);
        await Request("PUT", wakePath + "/" + missingWake + "/receipt", "acknowledgeWake", wakeAttachment, bearer: agentToken, nativeOnly: true);
        await Request("PUT", "/api/wake-rules/" + wakeRuleId, "changeWakeRule", WakeConfiguration(false, false));
        await Request("DELETE", "/api/wake-rules/" + wakeRuleId, "deleteWakeRule", JsonValues.Object(writer => writer.WriteNumber("expectedRevision", 1)));
        var measured = await Request("GET", "/api/fleets/" + fleetId + "/statistics", "fleetStatistics");
        Equal(measured.GetProperty("totals").GetProperty("delivered").GetInt64(), 2L, "database aggregates report exact delivered count");
        Equal(measured.GetProperty("tokens").GetProperty("input").GetInt64(), 0L, "initial cumulative native usage is a checkpoint, not historical billing");
        var observation = JsonValues.Object(writer =>
        {
            writer.WriteString("sessionId", "http-native-history"); writer.WriteNull("roomId"); writer.WriteString("runtime", "codex"); writer.WriteString("state", "working");
            writer.WriteNumber("observedAt", Identity.Now()); writer.WriteNumber("lastActivityAt", Identity.Now()); writer.WriteBoolean("historyAvailable", true); writer.WriteString("historyMode", "shared");
            writer.WriteNumber("maxInputBytes", 65536); writer.WriteStartArray("settings"); writer.WriteStartObject(); writer.WriteString("name", "model"); writer.WriteString("configured", "verified-model"); writer.WriteString("effective", "verified-model");
            writer.WriteEndObject(); writer.WriteEndArray(); writer.WriteNull("errorMessage");
        });
        await Request("PUT", "/api/agents/" + agentId + "/listener-runs/" + runId + "/runtime", "reportRuntime", observation, bearer: agentToken, nativeOnly: true);
        await Request("GET", "/api/agents/" + agentId + "/runtime-observations", "runtimeObservations");
        var decisionId = Identity.Identifier();
        var question = JsonValues.Object(writer =>
        {
            writer.WriteString("id", decisionId); writer.WriteString("runId", runId); writer.WriteString("runtime", "codex"); writer.WriteString("sessionId", "http-native-history");
            writer.WriteString("requestId", "decision-request"); writer.WriteString("turnId", "decision-turn"); writer.WriteString("itemId", "decision-item"); writer.WriteString("kind", "question"); writer.WriteString("action", "Choose an option");
            writer.WriteString("review", "Native requested review"); writer.WriteBoolean("blocking", true); writer.WriteNull("expiresAt"); writer.WriteStartArray("questions"); writer.WriteStartObject(); writer.WriteString("id", "choice");
            writer.WriteString("title", "Confirmation"); writer.WriteString("prompt", "Proceed?"); writer.WriteBoolean("secret", false); writer.WriteBoolean("allowText", false); writer.WriteStartArray("options");
            writer.WriteStartObject(); writer.WriteString("id", "yes"); writer.WriteString("label", "Yes"); writer.WriteString("description", "Proceed with the requested action"); writer.WriteEndObject();
            writer.WriteEndArray(); writer.WriteEndObject(); writer.WriteEndArray();
        });
        await Request("POST", "/api/agents/" + agentId + "/runtime-decisions", "createRuntimeDecision", question, bearer: agentToken, nativeOnly: true);
        await Request("GET", "/api/agents/" + agentId + "/runtime-decisions?status=pending", "runtimeDecisions");
        await Request("GET", "/api/agents/" + agentId + "/runtime-decisions/" + decisionId, "runtimeDecision");
        await Request("POST", "/api/agents/" + agentId + "/runtime-decisions/" + decisionId + "/answer", "answerRuntimeDecision", JsonValues.Object(writer =>
        { writer.WriteStartArray("answers"); writer.WriteStartObject(); writer.WriteString("questionId", "choice"); writer.WriteString("optionId", "yes"); writer.WriteNull("text"); writer.WriteEndObject(); writer.WriteEndArray(); }));
        var answer = await Request("GET", "/api/agents/" + agentId + "/runtime-decisions/" + decisionId + "/answer", "pollRuntimeDecision", bearer: agentToken, nativeOnly: true);
        Equal(answer.GetProperty("answers")[0].GetProperty("optionId").GetString(), "yes", "only the original native agent receives the private owner answer");
        await Request("PUT", "/api/agents/" + agentId + "/runtime-decisions/" + decisionId + "/receipt", "receiptRuntimeDecision", JsonValues.Object(writer => writer.WriteString("status", "responded")), bearer: agentToken, nativeOnly: true);
        var messageId = Identity.Identifier();
        await Request("POST", "/api/fleets/" + fleetId + "/messages", "createFleetMessage", JsonValues.Object(writer => { writer.WriteString("messageId", messageId); writer.WriteString("body", "Resume the reviewed task."); }));
        await Request("GET", "/api/fleets/" + fleetId + "/messages", "fleetMessages");
        await Request("PUT", "/api/fleets/" + fleetId + "/messages/" + messageId + "/deliveries/" + agentId, "acknowledgeFleetMessage", JsonValues.Object(writer => { writer.WriteString("status", "delivered"); writer.WriteNull("errorMessage"); }), bearer: controller, nativeOnly: true);
        var operationId = Identity.Identifier();
        await Request("POST", "/api/fleets/" + fleetId + "/session-operations", "requestFleetRuntime", JsonValues.Object(writer =>
        { writer.WriteString("operationId", operationId); writer.WriteNull("agentId"); writer.WriteString("action", "stop"); writer.WriteNumber("expectedRevision", revision); writer.WriteBoolean("confirmFreshHistory", false); }));
        await Request("GET", "/api/fleets/" + fleetId + "/session-operations", "fleetRuntimeOperations");
        await Request("PUT", "/api/fleets/" + fleetId + "/session-operations/" + operationId + "/claim", "claimFleetRuntime", JsonValues.Object(writer => writer.WriteString("connectionId", connectionId)), bearer: controller, nativeOnly: true);
        await Request("PUT", "/api/agents/" + agentId + "/listener-runs/" + runId, "reportListener", Heartbeat(true, false), bearer: agentToken, nativeOnly: true);
        await Request("PUT", "/api/fleets/" + fleetId + "/agents/" + agentId + "/native-stop", "recordFleetNativeStop", JsonValues.Object(writer =>
        { writer.WriteString("connectionId", connectionId); writer.WriteString("runId", runId); writer.WriteString("receiptId", Identity.Identifier()); }), bearer: controller, nativeOnly: true);
        await Request("PUT", "/api/fleets/" + fleetId + "/session-operations/" + operationId + "/receipt", "receiptFleetRuntime", JsonValues.Object(writer =>
        { writer.WriteString("connectionId", connectionId); writer.WriteString("status", "succeeded"); writer.WriteNull("errorMessage"); }), bearer: controller, nativeOnly: true);
        await Request("PUT", "/api/fleets/" + fleetId + "/delivery", "changeFleetDelivery", JsonValues.Object(writer => { writer.WriteNumber("expectedRevision", revision + 1); writer.WriteBoolean("enabled", false); }));
        await Request("PATCH", "/api/fleets/" + fleetId, "changeFleet", JsonValues.Object(writer =>
        { writer.WriteNumber("expectedRevision", revision + 2); writer.WriteString("label", "Reviewed HTTP fleet"); writer.WriteStartObject("controller"); writer.WriteString("name", "Reviewed HTTP controller"); writer.WriteEndObject(); }));
        var invitation = await Request("POST", "/api/member-invitations", "createInvitation", JsonValues.Object(writer => { writer.WriteString("roleCode", "member"); writer.WriteNumber("expiresSeconds", 600); }));
        var invitationId = invitation.GetProperty("invitationId").GetString()!;
        await Request("GET", "/api/member-invitations", "invitations");
        await Request("GET", "/api/audit-events", "audit");
        await Request("GET", "/api/member-invitations/" + invitationId, "invitation");
        await Request("POST", "/api/member-invitations/" + invitationId + "/claim", "claimInvitation", JsonValues.Object(writer => writer.WriteString("claimSecret", invitation.GetProperty("claimSecret").GetString())));
        await NativeServerAcceptance.Verify(client, baseUri, owner, ownerToken, serverName, cookieJar[InvitationCookies.Name], matrix);
        var disposable = await Request("POST", "/api/member-invitations", "createInvitation", JsonValues.Object(writer => { writer.WriteString("roleCode", "member"); writer.WriteNumber("expiresSeconds", 600); }));
        await Request("DELETE", "/api/member-invitations/" + disposable.GetProperty("invitationId").GetString(), "revokeInvitation", empty);
        await Request("DELETE", "/api/sessions/current", "endSession", empty);
        await Request("GET", "/api/sessions/current", null, failure: 401);
        Equal(wakeCount >= 5, true, "successful HTTP mutations wake the same reconciliation owner");
        await PublicAcceptance.Verify(state, owner, cookieJar[InvitationCookies.Name]);
        var onboarding = JsonValues.Array(new[] { owner, "@owner'quoted:example.test" }, (writer, target) =>
        {
            writer.WriteStartObject(); writer.WriteString("origin", state.Configuration.PublicOrigin); writer.WriteString("owner", target); writer.WriteString("version", state.Release.Version);
            writer.WriteString("instructions", "Private operator instructions: naïve and 𐐀\nExact second line");
            writer.WriteString("command", Onboarding.Command(state.Configuration.PublicOrigin, target, state.Release.Version));
            writer.WriteString("guide", Onboarding.Guide(state.Configuration.PublicOrigin, target, state.Release.Version, "Private operator instructions: naïve and 𐐀\nExact second line"));
            writer.WritePropertyName("descriptor"); Onboarding.Descriptor(state.Configuration.PublicOrigin, target, state.Release.Version, "Private operator instructions: naïve and 𐐀\nExact second line").WriteTo(writer);
            writer.WriteEndObject();
        });
        File.WriteAllBytes(Path.Combine(releaseDirectory, "protocol-samples.json"), JsonSerializer.SerializeToUtf8Bytes(onboarding, ApiJson.Default.JsonElement));
        Equal(System.IO.Directory.EnumerateFiles(database + ".logs").Any(), false, "C# API requests have no unhandled server diagnostics");
        var exported = JsonValues.Array(samples, (writer, sample) =>
        {
            writer.WriteStartObject(); writer.WriteString("operation", sample.Operation); writer.WriteNumber("status", sample.Status); writer.WritePropertyName("data"); sample.Data.WriteTo(writer); writer.WriteEndObject();
        });
        PrivateFiles.Write(Path.Combine(releaseDirectory, "http-samples.json"), JsonSerializer.SerializeToUtf8Bytes(exported, ApiJson.Default.JsonElement), 1048576);
        await application.StopAsync();
        await contentApplication.StopAsync();
    }
}
