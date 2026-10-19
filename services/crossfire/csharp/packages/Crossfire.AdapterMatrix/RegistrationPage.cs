using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace Crossfire.AdapterMatrix;

public static class RegistrationPage
{
    private const string Style = "body{margin:0;background:#f8f6ef;color:#242c2c;font:18px/1.6 system-ui,sans-serif}main{max-width:32rem;margin:12vh auto;padding:2rem}h1{font-size:2rem;line-height:1.2}button{background:#f0dbe9;color:#242c2c;border:1px solid #242c2c;border-radius:4px;padding:.8rem 1.2rem;font:inherit;cursor:pointer}strong{overflow-wrap:anywhere}";
    private const string Completion = "if(window.onAuthDone){window.onAuthDone()}else if(window.opener&&window.opener.postMessage){window.opener.postMessage(\"authDone\",location.origin)}";

    public static Task Error(HttpContext http, int status, string message)
        => Send(http, status, "Unable to continue", "<p>" + WebUtility.HtmlEncode(message) + "</p>", false);

    public static Task Confirm(HttpContext http, string username, string server, string nonce, bool invited)
        => Send(http, 200, invited ? "Confirm your invitation" : "Confirm your account", "<p>Create <strong>@" + WebUtility.HtmlEncode(username) + ":" + WebUtility.HtmlEncode(server)
            + "</strong>" + (invited ? " using your private invitation" : "") + "?</p><p>Your username and password are chosen in Element. Confirm this account, then return to Element to finish.</p>"
            + "<form method=\"post\"><input type=\"hidden\" name=\"nonce\" value=\"" + WebUtility.HtmlEncode(nonce) + "\"><button type=\"submit\">" + (invited ? "Confirm invitation" : "Create account") + "</button></form>", false);

    public static Task Completed(HttpContext http)
        => Send(http, 200, "Account confirmed", "<p>Return to Element to finish creating your account.</p>", true);

    private static Task Send(HttpContext http, int status, string title, string body, bool completed)
    {
        static string Hash(string value) => "'sha256-" + Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(value))) + "'";
        var response = http.Response; response.StatusCode = status; response.ContentType = "text/html; charset=utf-8";
        response.Headers.CacheControl = "no-store"; response.Headers["Referrer-Policy"] = "same-origin";
        response.Headers.XContentTypeOptions = "nosniff"; response.Headers.XFrameOptions = "DENY";
        response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src " + Hash(Style) + "; script-src " + (completed ? Hash(Completion) : "'none'")
            + "; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
        return response.WriteAsync("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + title
            + "</title><style>" + Style + "</style></head><body><main><h1>" + title + "</h1>" + body + "</main>" + (completed ? "<script>" + Completion + "</script>" : "") + "</body></html>", http.RequestAborted);
    }
}
