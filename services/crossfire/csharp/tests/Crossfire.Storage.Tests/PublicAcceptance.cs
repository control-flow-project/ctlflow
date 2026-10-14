using System.Net.Http.Headers;
using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Server;
using Crossfire.Server.Http;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class PublicAcceptance
{
    public static async Task Verify(ApiState state, string owner, string invitationCookie)
    {
        var root = PrivateFiles.Directory(state.Database + ".web-fixture"); var web = PrivateFiles.Directory(Path.Combine(root, "web")); var element = PrivateFiles.Directory(Path.Combine(root, "element"));
        PrivateFiles.Write(Path.Combine(web, "index.html"), "<title>Management</title>"u8, 1024);
        PrivateFiles.Write(Path.Combine(element, "index.html"), "<title>Element</title>"u8, 1024);
        PrivateFiles.Write(Path.Combine(element, "config.127.0.0.1.json"), "{\"brand\":\"Native fixture\",\"disable_registration\":false,\"default_server_config\":{\"private\":true}}"u8, 1024);
        var assets = PrivateFiles.Directory(Path.Combine(web, "assets")); PrivateFiles.Write(Path.Combine(assets, "app.js"), "console.log('shared');"u8, 1024);
        File.CreateSymbolicLink(Path.Combine(assets, "escape.js"), Path.Combine(root, "secret")); PrivateFiles.Write(Path.Combine(root, "secret"), "private"u8, 1024);
        using var proxy = new MatrixProxy();
        await using var app = PublicApplication.Build(state, "http://127.0.0.1:0", web, element, proxy, () => { });
        await app.StartAsync(); using var client = NativeHttp.Client(); var origin = app.Urls.Single();
        async Task<string> Read(string method, string path, int expected, string host = "127.0.0.1", string? cookie = null)
        {
            using var request = new HttpRequestMessage(new(method), new Uri(origin + path, new UriCreationOptions { DangerousDisablePathAndQueryCanonicalization = true }));
            request.Headers.Host = host; if (cookie is not null) request.Headers.TryAddWithoutValidation("Cookie", cookie);
            using var response = await client.SendAsync(request); var text = await response.Content.ReadAsStringAsync();
            Equal((int)response.StatusCode, expected, "public front door " + method + " " + path + (expected == (int)response.StatusCode ? "" : ": " + text));
            Equal(response.Headers.Contains("Set-Cookie"), false, "read-only public routes never create browser credentials");
            if (path.StartsWith("/manage/", StringComparison.Ordinal) && expected == 200) Equal(response.Headers.GetValues("Content-Security-Policy").Single().Contains("script-src 'self'", StringComparison.Ordinal), true, "shared management assets have a script isolation policy");
            return text;
        }
        await Read("GET", "/", 403, "foreign.example");
        Equal(await Read("GET", "/", 200), "<title>Element</title>", "public root serves the shared Element build");
        Equal(await Read("GET", "/manage/fleets/not-a-file", 200), "<title>Management</title>", "durable management URL serves one shared SPA");
        Equal(await Read("GET", "/manage/assets/app.js", 200), "console.log('shared');", "management assets stay under their shared root");
        Equal(await Read("HEAD", "/manage/assets/app.js", 200), "", "HEAD returns no static bytes");
        await Read("GET", "/manage/assets/escape.js", 404);
        await Read("GET", "/manage/assets/.hidden", 404);
        await Read("POST", "/", 405);
        using (var wellKnown = JsonDocument.Parse(await Read("GET", "/.well-known/matrix/client", 200)))
            Equal(wellKnown.RootElement.GetProperty("m.homeserver").GetProperty("base_url").GetString(), state.Configuration.PublicOrigin, "well-known advertises the public origin, never the private Matrix endpoint");
        using (var configuration = JsonDocument.Parse(await Read("GET", "/config.json", 200)))
        {
            Equal(configuration.RootElement.GetProperty("brand").GetString(), "Native fixture", "site presentation overrides only approved fields");
            Equal(configuration.RootElement.GetProperty("disable_registration").GetBoolean(), true, "site branding cannot bypass invitation policy");
            Equal(configuration.RootElement.GetProperty("default_server_config").GetProperty("m.homeserver").GetProperty("base_url").GetString(), state.Configuration.PublicOrigin, "site configuration cannot replace native identity authority");
        }
        await Read("HEAD", "/config.127.0.0.1.json", 200);
        using (var context = new CrossfireDbContext(state.Database))
        {
            var principal = MemberQueries.ByMatrixId(context, owner).Value!;
            var created = Invitations.Create(InvitationCommands.Ports(context, state.Now), new(principal.Id, "human", new NativeAuthentication(owner)), "member", 600, Crossfire.Kernel.Identity.Identifier());
            Equal(created.IsSuccess, true, "native signup fixture creates a current invitation");
            var cookie = InvitationCookies.Name + "=" + created.Value.InvitationId + "." + created.Value.ClaimSecret;
            using var shown = JsonDocument.Parse(await Read("GET", "/config.json", 200, cookie: cookie));
            Equal(shown.RootElement.GetProperty("disable_registration").GetBoolean(), false, "valid private invitation enables native signup presentation");
            using var stale = JsonDocument.Parse(await Read("GET", "/config.json", 200, cookie: invitationCookie));
            Equal(stale.RootElement.GetProperty("disable_registration").GetBoolean(), true, "consumed invitation does not enable new signup");
        }
        await Read("PUT", "/config.json", 405);
        await Read("GET", "/onboarding/setup.json", 400);
        await Read("GET", "/onboarding/setup.json?ownerMatrixId=" + Uri.EscapeDataString(owner) + "&unknown=true", 400);
        await Read("GET", "/onboarding/setup.json?ownerMatrixId=%40unknown%3Aexample.test", 403);
        var descriptorPath = "/onboarding/setup.json?ownerMatrixId=" + Uri.EscapeDataString(owner);
        using (var descriptor = JsonDocument.Parse(await Read("GET", descriptorPath, 200)))
        {
            Equal(descriptor.RootElement.GetProperty("ownerMatrixId").GetString(), owner, "setup descriptor binds a registered human identity");
            Equal(descriptor.RootElement.GetProperty("package").GetProperty("version").GetString(), state.Release.Version, "setup uses the exact coordinated public release");
            Equal(descriptor.RootElement.GetProperty("package").GetProperty("name").GetString(), "@ctlflow/fleet", "internal modules are not published by onboarding");
        }
        var guide = await Read("GET", descriptorPath.Replace("setup.json", "setup", StringComparison.Ordinal), 200);
        Equal(guide.Contains("This coding session only performs setup.", StringComparison.Ordinal), true, "onboarding cannot adopt the current coding session");
        Equal(guide.Contains(Onboarding.Command(state.Configuration.PublicOrigin, owner, state.Release.Version), StringComparison.Ordinal), true, "onboarding includes the complete pinned private installation command");
        foreach (var name in Releases.ArtifactNames)
            Equal(await Read("GET", "/onboarding/" + state.Release.Identity + "/" + name, 200), System.Text.Encoding.UTF8.GetString(state.Release.Files[name]), "immutable onboarding artifact retains exact release bytes");
        await Read("GET", "/onboarding/" + state.Release.Identity + "/not-an-artifact", 404);
        using (var version = JsonDocument.Parse(await Read("GET", "/_matrix/client/versions", 200))) Equal(version.RootElement.GetProperty("versions").GetArrayLength() > 0, true, "native Matrix traffic is streamed to the actual homeserver");
        foreach (var path in new[] { "/_matrix/client/r0/register", "/_matrix/client/v3/register/", "/_matrix/client/v3/%72egister", "/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web/" })
            await Read("POST", path, 404);
        await Read("PUT", "/_matrix/client/r0/profile/%40owner%3Aexample.test/displayname", 404);
        await Read("PUT", "/_matrix/client/v3/profile/%40owner%3Aexample.test/displayname/", 404);
        await Read("GET", "/manage/assets/%", 404);
        await app.StopAsync();
        System.IO.Directory.Delete(root, recursive: true);
    }
}
