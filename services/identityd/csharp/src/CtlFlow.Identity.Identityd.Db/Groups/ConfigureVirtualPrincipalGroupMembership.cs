using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Groups;

internal static partial class GroupSchema
{
    internal static void ConfigureVirtualPrincipalGroupMembership(
        ModelBuilder modelBuilder)
    {
        var membership =
            modelBuilder.Entity<VirtualPrincipalGroupMembership>();
        membership.ToTable("virtual_principal_group_memberships");
        membership.Ignore(value => value.PrincipalId);
        membership.Ignore(value => value.GroupId);
        membership.HasKey("_principalId", "_groupId");

        membership.Property<string>("_principalId")
            .HasColumnName("principal_id")
            .HasMaxLength(256)
            .IsRequired();
        membership.Property<string>("_groupId")
            .HasColumnName("group_id")
            .HasMaxLength(64)
            .IsRequired();

        membership.HasOne<VirtualPrincipal>()
            .WithMany()
            .HasForeignKey("_principalId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
        membership.HasOne<Group>()
            .WithMany()
            .HasForeignKey("_groupId")
            .HasPrincipalKey("_id")
            .OnDelete(DeleteBehavior.Restrict);
    }
}
