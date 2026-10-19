using System.Text.Json;
using Crossfire.Domain;
using Crossfire.Kernel;
using Microsoft.AspNetCore.Http;

namespace Crossfire.AdapterMatrix;

public sealed record MatrixWebServices(string PublicOrigin, string ServerName, MessagingPorts Messaging, Func<long> Now,
    Func<Result<InstancePolicy?>> Policy,
    Func<string, string, Result<Unit>> VerifyInvitation,
    Func<MemberSignup, MemberSignupClaim?, string, CancellationToken, ValueTask<Result<BackendAccount>>> Register,
    Func<string, CancellationToken, ValueTask<Result<Actor>>> Authenticate,
    Func<Actor, string, int, Result<Page<PrincipalSummary>>> Search,
    Func<Actor, string, string, string, CancellationToken, ValueTask<Result<Unit>>> ChangeName,
    Func<HttpRequest, int, CancellationToken, ValueTask<Result<JsonElement>>> Read,
    Func<HttpRequest, int, CancellationToken, ValueTask<Result<byte[]>>> ReadBytes,
    Func<HttpRequest, IReadOnlyList<string>, Result<IReadOnlyDictionary<string, string>>> Query,
    Func<HttpRequest, MemberSignupClaim?> Invitation,
    Action<HttpResponse> ClearInvitation);
