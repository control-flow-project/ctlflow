namespace Crossfire.AdapterSqlite.Entities;

public class RuntimeDecisionAnswerRow
{
    public string DecisionId { get; set; } = "";
    public string QuestionId { get; set; } = "";
    public string? OptionId { get; set; }
    public string? AnswerText { get; set; }
}
