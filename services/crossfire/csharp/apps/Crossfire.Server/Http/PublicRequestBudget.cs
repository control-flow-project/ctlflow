using System.Net;
using System.Text.Json;
using Crossfire.Contracts;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public static class PublicRequestBudget
{
    public static string? AddressKey(string? value)
    {
        if (value is null || value.Contains('%') || !IPAddress.TryParse(value, out var address)) return null;
        if (!value.Contains(':')) return address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && address.ToString() == value ? value : null;
        if (value.Any(character => !char.IsAsciiHexDigit(character) && character is not (':' or '.')) || value.Contains('.') && AddressKey(value[(value.LastIndexOf(':') + 1)..]) is null) return null;
        if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6) return null;
        if (address.IsIPv4MappedToIPv6) return address.MapToIPv4().ToString();
        var bytes = address.GetAddressBytes();
        return string.Join(':', Enumerable.Range(0, 8).Select(index => ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).ToString("x4", System.Globalization.CultureInfo.InvariantCulture)));
    }
    public static Result<IReadOnlyList<string>> Proxies(JsonElement input)
    {
        var entries = Validation.List(input, entry => Validation.Text(entry, 64), 32);
        if (!entries.IsSuccess) return Result<IReadOnlyList<string>>.Fail(entries.Error);
        var addresses = new List<string>();
        foreach (var entry in entries.Value)
        {
            var key = AddressKey(entry);
            if (key is null || addresses.Contains(key, StringComparer.Ordinal)) return Results.Fail<IReadOnlyList<string>>("invalid", "trustedProxyAddresses must contain distinct literal IP addresses without scopes or networks");
            addresses.Add(key);
        }
        return Result<IReadOnlyList<string>>.Success(addresses);
    }
    public static Func<HttpContext, Result<Unit>> Create(Func<long> now, IReadOnlyList<string>? proxies = null)
    {
        var trusted = new HashSet<string>(proxies ?? [], StringComparer.Ordinal);
        var clients = new Dictionary<string, (int Count, long ExpiresAt)>(StringComparer.Ordinal);
        var aggregate = (Count: 0, ExpiresAt: 0L); var gate = new object(); var nextExpiry = long.MaxValue;
        return http =>
        {
            var address = AddressKey(http.Connection.RemoteIpAddress?.ToString());
            if (address is null) return Results.Fail<Unit>("forbidden", "Client address is unavailable");
            if (trusted.Contains(address))
            {
                var forwarded = http.Request.Headers["X-Forwarded-For"];
                if (forwarded.Count != 1 || (address = AddressKey(forwarded[0])) is null) return Results.Fail<Unit>("forbidden", "Trusted ingress must overwrite X-Forwarded-For with one literal client IP address");
            }
            lock (gate)
            {
                var time = now();
                if (time >= nextExpiry)
                {
                    nextExpiry = long.MaxValue;
                    foreach (var key in clients.Keys.ToArray())
                    {
                        var retained = clients[key];
                        if (retained.ExpiresAt <= time) clients.Remove(key);
                        else nextExpiry = Math.Min(nextExpiry, retained.ExpiresAt);
                    }
                }
                if (aggregate.ExpiresAt <= time) aggregate = (0, time + 60000);
                if (!clients.TryGetValue(address, out var entry)) entry = (0, time + 60000);
                if (entry.Count >= HttpLimits.PublicMutationsPerMinute || aggregate.Count >= HttpLimits.PublicMutationsGlobalPerMinute
                    || !clients.ContainsKey(address) && clients.Count >= HttpLimits.PublicMutationClients) return Results.Fail<Unit>("rate_limit", "Request rate exceeded");
                clients[address] = (entry.Count + 1, entry.ExpiresAt); aggregate.Count++; nextExpiry = Math.Min(nextExpiry, entry.ExpiresAt);
                return Results.Done();
            }
        };
    }
}
