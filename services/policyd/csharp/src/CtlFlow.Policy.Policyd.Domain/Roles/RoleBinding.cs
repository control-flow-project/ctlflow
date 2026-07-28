using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Subjects;

namespace CtlFlow.Policy.Policyd.Domain.Roles;

public class RoleBinding
{
    private string _roleId = null!;
    private int _subjectKind;
    private string _subjectId = null!;

    private RoleBinding()
    {
    }

    public RoleBinding(
        RoleId roleId,
        SubjectKind subjectKind,
        SubjectId subjectId)
    {
        _roleId = roleId.Value;
        _subjectKind = SubjectKindCodes.ToStorage(subjectKind);
        _subjectId = subjectId.Value;
    }

    public RoleId RoleId => RoleId.FromStorage(_roleId);

    public SubjectKind SubjectKind =>
        SubjectKindCodes.FromStorage(_subjectKind);

    public SubjectId SubjectId =>
        SubjectId.FromStorage(SubjectKind, _subjectId);
}
