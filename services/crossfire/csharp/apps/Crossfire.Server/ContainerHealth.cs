using Crossfire.AdapterFilesystem;
using Crossfire.Kernel;

namespace Crossfire.Server;

public static class ContainerHealth
{
    public static async Task Verify()
    {
        var parsed = Configurations.Parse(WireJson.Parse(PrivateFiles.Read("/runtime/config.json", 65536)));
        if (!parsed.IsSuccess) throw new IOException(parsed.Error.Message);
        using var client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(3) };
        foreach (var path in new[] { "/api/health", "/_matrix/client/versions" })
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "http://127.0.0.1:8080" + path); request.Headers.Host = new Uri(parsed.Value.PublicOrigin).Authority;
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if ((int)response.StatusCode != 200) throw new IOException("Container readiness failed");
        }
    }
}
