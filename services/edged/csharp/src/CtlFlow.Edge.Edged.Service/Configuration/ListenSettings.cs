using System.Net;

namespace CtlFlow.Edge.Edged.Service.Configuration;

internal sealed record ListenSettings(IPAddress Address, int Port);
