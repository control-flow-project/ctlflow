using Crossfire.Kernel;

namespace Crossfire.Server.Http;

public delegate Task<bool> MessagingHttpHandler(HttpContext http, string path, string requestId);
public delegate MessagingHttpHandler MessagingHttpFactory(Func<HttpContext, Result<Unit>> admission, Action changed);
public delegate Task MessagingPublicRoutes(HttpContext http, string path, string rawTarget, RequestDelegate api, Func<HttpContext, string, string, Task> serve);
