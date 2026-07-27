using System.Net;

namespace CtlFlow.Auth.Authd.Service.Configuration;

internal sealed record ListenSettings(IPAddress Address, int Port);
