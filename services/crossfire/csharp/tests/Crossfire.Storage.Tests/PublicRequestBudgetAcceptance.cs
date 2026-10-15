using System.Net;
using Crossfire.Contracts;
using Crossfire.Server.Http;
using Microsoft.AspNetCore.Http;
using static Crossfire.Storage.Tests.Checks;

namespace Crossfire.Storage.Tests;

public static class PublicRequestBudgetAcceptance
{
    private static HttpContext Request(string peer, string? forwarded = null)
    {
        var http = new DefaultHttpContext(); http.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        if (forwarded is not null) http.Request.Headers["X-Forwarded-For"] = forwarded;
        return http;
    }
    public static void Verify()
    {
        Equal(PublicRequestBudget.AddressKey("::ffff:192.0.2.1"), "192.0.2.1", "mapped peer identities share a bucket");
        Equal(PublicRequestBudget.AddressKey("2001:DB8::1"), "2001:0db8:0000:0000:0000:0000:0000:0001", "IPv6 identity normalization matches Node");
        foreach (var invalid in new[] { "127.1", "0177.0.0.1", "2130706433", "127.0.0.1:80", "::1%lo", " 127.0.0.1", "unknown", "192.0.2.1, 192.0.2.2" }) Equal(PublicRequestBudget.AddressKey(invalid) is null, true, "invalid ingress identity is rejected: " + invalid);
        long time = 0; var rate = PublicRequestBudget.Create(() => time, ["127.0.0.1"]);
        foreach (var invalid in new string?[] { null, "", "198.51.100.1, 203.0.113.1", "127.1" }) Equal(rate(Request("127.0.0.1", invalid)).IsSuccess, false, "trusted ingress requires one exact address");
        var duplicate = Request("127.0.0.1", "198.51.100.1"); duplicate.Request.Headers.Append("X-Forwarded-For", "198.51.100.1"); Equal(rate(duplicate).IsSuccess, false, "duplicated forwarded identity is rejected");
        for (var index = 0; index < HttpLimits.PublicMutationsPerMinute; index++) Equal(rate(Request("127.0.0.1", "198.51.100.1")).IsSuccess, true, "within client quota");
        Equal(rate(Request("127.0.0.1", "198.51.100.1")).IsSuccess, false, "client quota exhausted");
        Equal(rate(Request("127.0.0.1", "198.51.100.2")).IsSuccess, true, "other clients remain independent");
        time = 59999; Equal(rate(Request("127.0.0.1", "198.51.100.1")).IsSuccess, false, "quota does not expire early");
        time = 60000; Equal(rate(Request("127.0.0.1", "198.51.100.1")).IsSuccess, true, "quota expires at its exact boundary");
        var direct = PublicRequestBudget.Create(() => time);
        for (var index = 0; index < HttpLimits.PublicMutationsPerMinute; index++) Equal(direct(Request("192.0.2.1", "198.51.100." + index)).IsSuccess, true, "untrusted forwarding cannot select a bucket");
        Equal(direct(Request("::ffff:192.0.2.1", "203.0.113.1")).IsSuccess, false, "spoofed forwarding cannot reset the quota");
        var aggregate = PublicRequestBudget.Create(() => time, ["127.0.0.1"]);
        for (var index = 0; index < HttpLimits.PublicMutationsGlobalPerMinute; index++) Equal(aggregate(Request("127.0.0.1", "2001:db8::" + (index + 1).ToString("x", System.Globalization.CultureInfo.InvariantCulture))).IsSuccess, true, "within bounded aggregate budget");
        Equal(aggregate(Request("127.0.0.1", "203.0.113.2")).IsSuccess, false, "global protection remains bounded");
        time += 60000; Equal(aggregate(Request("127.0.0.1", "203.0.113.2")).IsSuccess, true, "aggregate rollover releases capacity");
    }
}
