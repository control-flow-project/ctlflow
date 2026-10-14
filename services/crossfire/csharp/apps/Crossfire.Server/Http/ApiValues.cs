using System.Text.Json;
using Crossfire.AdapterFilesystem;
using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Contracts;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public sealed record ApiState(ServerConfiguration Configuration, string Database, Release Release, AccountAuthority Matrix, PublicationStorage Publications, PlatformDiagnostics Diagnostics, long StartedAt, Func<long> Now);
public sealed record ApiContext(ApiState State, CrossfireDbContext Database, HttpContext Http, string RequestId, Actor? Identity,
    FleetControllerActor? Controller, AuthenticatedMember? Session, string Cookie, IReadOnlyDictionary<string, string> Query, FleetChanges Changes)
{
    public Actor Actor => Identity ?? throw new InvalidOperationException("Authenticated operation requires an actor");
    public FleetActor FleetActor => Controller is null ? new FleetPrincipalActor(Actor) : Controller;
    public AuthorizationPorts Authorization => AuthorizationQueries.Ports(Database, State.Now);
    public SessionPorts Sessions => SessionCommands.Ports(Database, State.Now, State.Matrix.Identify);
    public EnrollmentPorts Enrollments => EnrollmentCommands.Ports(Database, State.Now, State.Configuration.ServerName, State.Matrix.Identify, State.Matrix.Room);
}
public sealed record ApiReply(JsonElement Data, ResponseMetadata? Pagination = null, string? SetCookie = null);
public sealed record ApiEndpoint(string OperationName,
    Func<ApiContext, IReadOnlyDictionary<string, string>, JsonElement, ValueTask<Result<ApiReply>>> Handle,
    IReadOnlyList<string>? QueryFields = null)
{
    public RestOperation Operation => RestOperations.All[OperationName];
}

public static class Replies
{
    public static Result<ApiReply> Of(Result<JsonElement> result) => result.Map(value => new ApiReply(value));
    public static Result<ApiReply> Acknowledge(Result<Unit> result) => Of(JsonValues.Acknowledge(result));
    public static ValueTask<Result<ApiReply>> Ready(Result<ApiReply> result) => ValueTask.FromResult(result);
    public static Result<ApiReply> Paged<T>(Result<Page<T>> result, string requestId, Action<ProtocolWriter, T> write)
        => result.Map(value => new ApiReply(JsonValues.Array(value.Items, write), new(requestId, value.PageNumber, value.PageSize, value.TotalItems, value.TotalPages)));
}
