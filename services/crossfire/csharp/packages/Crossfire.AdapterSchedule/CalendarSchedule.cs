using System.Globalization;
using System.Text.RegularExpressions;
using Crossfire.Domain;
using Crossfire.Kernel;

namespace Crossfire.AdapterSchedule;

public static partial class CalendarSchedule
{
    private sealed record Field(ulong Mask, bool Wildcard, bool Last, ulong LastWeekday, int Nth);
    private sealed record Calendar(Field Minute, Field Hour, Field Day, Field Month, Field Weekday);
    private static readonly string[] Months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    private static readonly string[] Weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    [GeneratedRegex(@"^[A-Za-z_]+(?:/[A-Za-z0-9_+\-]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex ZonePattern();

    public static Result<long> Next(WakeSchedule schedule, long after)
    {
        if (after is < 0 or > 9007199254740991) return Results.Fail<long>("invalid", "Invalid scheduling time");
        if (schedule is IntervalSchedule interval)
            return interval.Seconds is < 1 or > 31536000 ? Results.Fail<long>("invalid", "Interval must be between 1 second and 365 days")
                : after > 9007199254740991 - interval.Seconds * 1000 ? Results.Fail<long>("invalid", "Scheduling time exceeds the supported range") : Result<long>.Success(after + interval.Seconds * 1000);
        if (schedule is not CronSchedule cron) return Results.Fail<long>("invalid", "Unknown schedule kind");
        if (cron.Expression.Length > 200 || cron.TimeZone.Length > 100 || !ZonePattern().IsMatch(cron.TimeZone)) return Results.Fail<long>("invalid", "Choose a five-field calendar schedule and an IANA time zone");
        var parsed = Parse(cron.Expression); if (!parsed.IsSuccess) return Result<long>.Fail(parsed.Error);
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(cron.TimeZone); var instant = DateTimeOffset.FromUnixTimeMilliseconds(after);
            var zoned = TimeZoneInfo.ConvertTime(instant, zone); var local = zoned.DateTime; var day = local.Date; var calendar = parsed.Value;
            var endYear = Math.Min(9999, day.Year + 400);
            while (day.Year <= endYear)
            {
                if (Contains(calendar.Month.Mask, day.Month) && MatchesDay(calendar, day))
                {
                    long? first = null;
                    for (var hour = 0; hour < 24; hour++)
                    {
                        if (!Contains(calendar.Hour.Mask, hour)) continue;
                        for (var minute = 0; minute < 60; minute++)
                        {
                            if (!Contains(calendar.Minute.Mask, minute)) continue;
                            var candidate = day.AddHours(hour).AddMinutes(minute);
                            var ambiguous = zone.IsAmbiguousTime(candidate); var everyHour = calendar.Hour.Mask == 0xffffff;
                            if (candidate < local && !(ambiguous && everyHour)) continue;
                            var utc = Resolve(zone, candidate);
                            if (ambiguous && (everyHour || day == local.Date && zone.IsAmbiguousTime(local) && zoned.Offset == zone.GetAmbiguousTimeOffsets(local).Min()))
                            {
                                var repeated = new DateTimeOffset(candidate, zone.GetAmbiguousTimeOffsets(candidate).Min()).ToUnixTimeMilliseconds();
                                if (utc <= after) utc = repeated;
                            }
                            if (utc > after)
                            {
                                var resolved = TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(utc), zone).DateTime;
                                if (resolved.Date != candidate.Date && (!Contains(calendar.Month.Mask, resolved.Month) || !MatchesDay(calendar, resolved))) continue;
                                first = Math.Min(first ?? long.MaxValue, utc);
                            }
                        }
                    }
                    if (first is not null) return Result<long>.Success(first.Value);
                }
                if (day.Year == 9999 && day.Month == 12 && day.Day == 31) break;
                day = day.AddDays(1);
            }
            return Results.Fail<long>("invalid", "The schedule has no next occurrence");
        }
        catch (Exception error) when (error is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException or OverflowException)
        { return Results.Fail<long>("invalid", "Invalid calendar schedule or time zone"); }
    }

    private static long Resolve(TimeZoneInfo zone, DateTime local)
    {
        if (zone.IsInvalidTime(local))
        {
            var before = local; var after = local;
            for (var count = 0; count < 49 && zone.IsInvalidTime(before); count++) before = before.AddHours(-1);
            for (var count = 0; count < 49 && zone.IsInvalidTime(after); count++) after = after.AddHours(1);
            local = local.Add(zone.GetUtcOffset(after) - zone.GetUtcOffset(before));
        }
        var offset = zone.IsAmbiguousTime(local) ? zone.GetAmbiguousTimeOffsets(local).Max() : zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUnixTimeMilliseconds();
    }

    private static bool Contains(ulong mask, int value) => (mask & (1UL << value)) != 0;
    private static bool MatchesDay(Calendar calendar, DateTime day)
    {
        var weekday = (int)day.DayOfWeek;
        var dayMatches = Contains(calendar.Day.Mask, day.Day) || calendar.Day.Last && day.Day == DateTime.DaysInMonth(day.Year, day.Month);
        var weekMatches = Contains(calendar.Weekday.Mask, weekday) || Contains(calendar.Weekday.LastWeekday, weekday) && day.Day + 7 > DateTime.DaysInMonth(day.Year, day.Month);
        if (calendar.Weekday.Nth != 0) weekMatches &= (day.Day - 1) / 7 + 1 == calendar.Weekday.Nth;
        return calendar.Day.Wildcard ? weekMatches : calendar.Weekday.Wildcard ? dayMatches : dayMatches || weekMatches;
    }

    private static Result<Calendar> Parse(string expression)
    {
        var values = TextRules.Trim(expression).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (values.Length != 5) return Results.Fail<Calendar>("invalid", "Use five cron fields; randomized fields and seconds are not supported");
        var minute = ParseField(values[0], 0, 59, 0); var hour = ParseField(values[1], 0, 23, 1); var day = ParseField(values[2], 1, 31, 2);
        var month = ParseField(values[3], 1, 12, 3); var weekday = ParseField(values[4], 0, 7, 4);
        if (!minute.IsSuccess || !hour.IsSuccess || !day.IsSuccess || !month.IsSuccess || !weekday.IsSuccess) return Results.Fail<Calendar>("invalid", "Invalid calendar fields");
        var calendar = new Calendar(minute.Value, hour.Value, day.Value, month.Value, weekday.Value);
        var possible = false;
        for (var year = 2000; year < 2400 && !possible; year++)
        for (var selectedMonth = 1; selectedMonth <= 12 && !possible; selectedMonth++)
        {
            if (!Contains(calendar.Month.Mask, selectedMonth)) continue;
            for (var selectedDay = 1; selectedDay <= DateTime.DaysInMonth(year, selectedMonth); selectedDay++)
                if (MatchesDay(calendar, new(year, selectedMonth, selectedDay))) { possible = true; break; }
        }
        return possible ? Result<Calendar>.Success(calendar) : Results.Fail<Calendar>("invalid", "The calendar schedule is impossible");
    }

    private static Result<Field> ParseField(string source, int minimum, int maximum, int field)
    {
        var text = source;
        if (field is 3 or 4)
        {
            var aliases = field == 3 ? Months : Weekdays;
            for (var index = 0; index < aliases.Length; index++) text = text.Replace(aliases[index], (index + (field == 3 ? 1 : 0)).ToString(CultureInfo.InvariantCulture), StringComparison.OrdinalIgnoreCase);
        }
        var nth = 0;
        if (text.Contains('#'))
        {
            var parts = text.Split('#');
            if (field != 4 || parts.Length != 2 || parts[0].Any(value => value is ',' or '-' or '/') || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out nth) || nth is < 1 or > 5) return Results.Fail<Field>("invalid", "Invalid calendar weekday occurrence");
            text = parts[0];
        }
        ulong mask = 0; ulong lastWeekday = 0; var last = false;
        foreach (var selection in text.Split(','))
        {
            if (selection == "L" && field == 2) { if (last) return Results.Fail<Field>("invalid", "Duplicate calendar value"); last = true; continue; }
            if (selection.EndsWith('L') && field == 4 && int.TryParse(selection.AsSpan(0, selection.Length - 1), NumberStyles.None, CultureInfo.InvariantCulture, out var lastDay) && lastDay is >= 0 and <= 7)
            { var bit = 1UL << (lastDay % 7); if ((lastWeekday & bit) != 0) return Results.Fail<Field>("invalid", "Duplicate calendar value"); lastWeekday |= bit; continue; }
            var parts = selection.Split('/');
            if (parts.Length > 2) return Results.Fail<Field>("invalid", "Invalid calendar step");
            var step = 1;
            if (parts.Length == 2 && (!int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out step) || step < 1)) return Results.Fail<Field>("invalid", "Invalid calendar step");
            var range = parts[0].Split('-'); var start = minimum; var end = maximum;
            if (parts[0] is not ("*" or "?"))
            {
                if (range.Length > 2 || !int.TryParse(range[0], NumberStyles.None, CultureInfo.InvariantCulture, out start)) return Results.Fail<Field>("invalid", "Invalid calendar range");
                if (range.Length == 2) { if (!int.TryParse(range[1], NumberStyles.None, CultureInfo.InvariantCulture, out end)) return Results.Fail<Field>("invalid", "Invalid calendar range"); }
                else if (parts.Length == 1) end = start;
            }
            if (start < minimum || end > maximum || start > end) return Results.Fail<Field>("invalid", "Calendar value is out of range");
            ulong selected = 0;
            for (long value = start; value <= end; value += step) selected |= 1UL << (field == 4 ? (int)(value % 7) : (int)value);
            if ((mask & selected) != 0) return Results.Fail<Field>("invalid", "Duplicate calendar value"); mask |= selected;
        }
        return mask == 0 && !last && lastWeekday == 0 ? Results.Fail<Field>("invalid", "Empty calendar field") : Result<Field>.Success(new(mask, source is "*" or "?", last, lastWeekday, nth));
    }
}
