using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Crossfire.AdapterCrossfire;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterHttp;
using Crossfire.Kernel;

internal static class ListenerAcceptance
{
    internal static async Task Run(string root, Action<bool, string> check)
    {
        var state = PrivateFiles.Directory(Path.Combine(root, "listener"));
        await using var host = await ListenerHost.Start(AgentState.Port, CancellationToken.None);
        using (var binding = host.Bind("analyst", "0.1.26-fixture", Path.Combine(state, "cursor.json"), Identity.Identifier, () => { }))
        {
            var file = Path.Combine(state, "listener.json"); var original = PrivateFiles.Read(file, 65536);
            var descriptor = WireJson.Parse(original); var port = host.Port;
            check(port is > 0 and <= 65535 && descriptor.GetProperty("port").GetInt32() == port,
                "VM forwarding uses the actual host listener port");
            var forged = WireJson.Object(writer => { writer.WriteNumber("port", port == 1 ? 2 : 1); writer.WriteString("secret", descriptor.GetProperty("secret").GetString()); writer.WriteString("binding", "analyst"); });
            PrivateFiles.Write(file, WireJson.Bytes(forged), 65536);
            check(host.Port == port, "A guest-writable descriptor cannot change the trusted forwarding target");
            using var http = NativeHttp.Client(); http.Timeout = TimeSpan.FromSeconds(5);
            foreach (var authorized in new[] { true, false })
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, "http://127.0.0.1:" + port.ToString(System.Globalization.CultureInfo.InvariantCulture) + "/bindings/analyst/control");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", authorized ? descriptor.GetProperty("secret").GetString() : "wrong-binding");
                request.Content = new StringContent("{\"action\":\"status\"}", Encoding.UTF8, "application/json");
                using var response = await http.SendAsync(request);
                check(response.StatusCode == (authorized ? HttpStatusCode.OK : HttpStatusCode.Forbidden),
                    "Actual listener authority remains in host memory after its exported descriptor is forged");
            }
            PrivateFiles.Write(file, original, 65536);
        }
    }
}
