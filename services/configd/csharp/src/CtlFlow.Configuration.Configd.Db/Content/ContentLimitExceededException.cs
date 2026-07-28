namespace CtlFlow.Configuration.Configd.Db.Content;

public sealed class ContentLimitExceededException : Exception
{
    public ContentLimitExceededException()
        : base("Content exceeds the admitted bound")
    {
    }
}
