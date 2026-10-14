using Crossfire.AdapterMatrix;
using Crossfire.AdapterSqlite;
using Crossfire.Domain;
using Crossfire.Kernel;
using Crossfire.Server.Http;

namespace Crossfire.Server;

public static class ApiApplication
{
    public static IReadOnlyList<ApiEndpoint> Endpoints()
        => [.. SessionRoutes.Endpoints(), .. EnrollmentRoutes.Endpoints(), .. MemberRoutes.Endpoints(), .. InstanceRoutes.Endpoints(), .. DiscoveryRoutes.Endpoints(), .. InvitationRoutes.Endpoints(), .. FleetControlRoutes.Endpoints(), .. RuntimeRoutes.Endpoints(), .. ListenerRoutes.Endpoints(), .. AgentRoutes.Endpoints(), .. FleetReadRoutes.Endpoints(), .. RoomRoutes.Endpoints(), .. RoomPlanRoutes.Endpoints(), .. AuditRoutes.Endpoints(), .. WakeRoutes.Endpoints(), .. WakeNoticeRoutes.Endpoints(), .. FleetMapRoutes.Endpoints(), .. PublicationRoutes.Endpoints()];

    public static void Initialize(ApiState state)
    {
        using (var database = new CrossfireDbContext(state.Database))
        {
            var schema = Schema.Validate(database);
            if (!schema.IsSuccess) throw new IOException(schema.Error.Message);
            var initialized = PrincipalValues.Initialize(PolicyQueries.Ports(database, state.Now), state.Configuration.Administrator);
            if (!initialized.IsSuccess) throw new IOException(initialized.Error.Message);
        }
    }

    public static WebApplication Build(ApiState state, string listen, Action wake)
    {
        Initialize(state);
        var builder = WebApplication.CreateSlimBuilder(); builder.Logging.ClearProviders(); builder.WebHost.UseUrls(listen);
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.AddServerHeader = false; options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10); options.Limits.MaxRequestBodySize = 16 * 1024 * 1024;
        });
        var application = builder.Build(); application.Run(ApiPipeline.Create(state, Endpoints(), wake));
        return application;
    }
}
