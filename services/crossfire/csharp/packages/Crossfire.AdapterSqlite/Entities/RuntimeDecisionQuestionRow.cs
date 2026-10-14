namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeDecisionQuestionRow
{
    public string DecisionId { get; set; } = "";
    public string QuestionId { get; set; } = "";
    public long Position { get; set; }
    public string Title { get; set; } = "";
    public string Prompt { get; set; } = "";
    public long Secret { get; set; }
    public long AllowText { get; set; }
}
