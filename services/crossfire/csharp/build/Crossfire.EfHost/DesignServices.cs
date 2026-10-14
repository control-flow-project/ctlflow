using Crossfire.Build.Ef;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using System.Diagnostics.CodeAnalysis;

[assembly: DesignTimeServicesReference("Crossfire.EfHost.DesignServices, Crossfire.EfHost")]

namespace Crossfire.EfHost;

[Experimental("EF9100")]
[SuppressMessage("Usage", "EF1001", Justification = "Registers the version-pinned build-time query generator through EF's design-time interface; no native safety diagnostics are suppressed.")]
public sealed class DesignServices : IDesignTimeServices
{
    public void ConfigureDesignTimeServices(IServiceCollection services)
        => services.Replace(ServiceDescriptor.Singleton<IPrecompiledQueryCodeGenerator, CrossfirePrecompiledQueryCodeGenerator>());
}
