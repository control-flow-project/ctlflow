using Crossfire.AdapterFilesystem;
using Crossfire.AgentCore;

namespace Crossfire.AdapterClient;

public static class AgentState
{
    public static LocalState Port { get; } = new(PrivateFiles.Exists, PrivateFiles.Read, (path, bytes, maximum) => PrivateFiles.Write(path, bytes.Span, maximum), PrivateFiles.DeletePrivate);
}
