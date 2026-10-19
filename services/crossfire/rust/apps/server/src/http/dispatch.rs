use super::{
    context::Context,
    enrollment, fleet, fleet_read, identity, publication,
    reply::{self, Reply},
    rooms, runtime, wake,
};
use crossfire_contracts::operations::OperationId;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;

pub async fn invoke(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    use OperationId::*;
    match context.selection.operation.id {
        MessagingBackend => {
            context.empty()?;
            reply::of(crossfire_contracts::messaging::description_value(
                &context.state.messaging.describe(
                    context
                        .state
                        .configuration
                        .public_origin
                        .as_str()
                        .trim_end_matches('/'),
                ),
            ))
        }
        AuthenticateBackend => identity::authenticate_backend(context).await,
        RecordFleetNativeStop => fleet::native_stop(context),
        CreatePublication => publication::create(context),
        Publications => publication::list(context),
        Publication => publication::read(context),
        UploadPublicationFile => Err(Failure::new(
            ErrorCode::Unavailable,
            "Binary operations require their declared stream transport",
        )),
        CommitPublication => publication::commit(context).await,
        DeletePublication => publication::delete(context),
        FleetRuntimeOperations => fleet::operations(context),
        RequestFleetRuntime => fleet::request(context),
        ClaimFleetRuntime => fleet::claim(context),
        ReceiptFleetRuntime => fleet::receipt(context),
        RuntimeObservations => runtime::observations(context),
        ReportRuntime => runtime::report(context),
        RuntimeDecisions => runtime::decisions(context),
        CreateRuntimeDecision => runtime::create_decision(context),
        RuntimeDecision => runtime::decision(context),
        AnswerRuntimeDecision => runtime::answer(context),
        PollRuntimeDecision => runtime::poll(context),
        ReceiptRuntimeDecision => runtime::receipt(context),
        ReportFleetFailure => runtime::failure(context),
        WakeRules => wake::list(context),
        CreateWakeRule => wake::create(context),
        WakeRule => wake::read(context),
        ChangeWakeRule => wake::change(context),
        DeleteWakeRule => wake::delete(context),
        WakeMetadata => wake::metadata(context),
        ClaimWake => wake::claim(context),
        ValidateWake => wake::validate(context),
        AcknowledgeWake => wake::acknowledge(context),
        CreateSession => identity::create_session(context).await,
        CurrentSession => identity::current_session(context),
        EndSession => identity::end_session(context),
        Principals => identity::principals(context),
        ResolvePrincipals => identity::resolve(context),
        Roles => identity::roles(context),
        Permissions => identity::permissions(context),
        Members => identity::members(context),
        Member => identity::member(context),
        ChangeMember => identity::change_member(context, false),
        MemberRole => identity::change_member(context, true),
        CreateInvitation => identity::create_invitation(context),
        Invitations => identity::invitations(context),
        Invitation => identity::invitation(context),
        RevokeInvitation => identity::revoke_invitation(context),
        ClaimInvitation => identity::claim_invitation(context),
        RegistrationPolicy => identity::registration_policy(context),
        Preflight => enrollment::preflight(context).await,
        IntroduceEnrollment => enrollment::introduce(context).await,
        Enrollments => enrollment::list(context),
        Enrollment => enrollment::read(context),
        DecideEnrollment => enrollment::decide(context),
        ExchangeEnrollment => enrollment::exchange(context),
        Fleets => fleet::list(context),
        Fleet => fleet::read(context),
        ChangeFleet => fleet::change(context),
        ArchiveFleet => fleet::archive(context),
        FleetMap => fleet_read::map(context).await,
        FleetStatistics => fleet_read::statistics(context),
        FleetAgents => fleet::agents(context),
        ChangeFleetDelivery => fleet::delivery(context),
        ReportFleetConnection => fleet::connection(context),
        FleetControl => fleet::control(context).await,
        FleetMessages => fleet::messages(context),
        CreateFleetMessage => fleet::create_message(context),
        AcknowledgeFleetMessage => fleet::acknowledge(context),
        RemoveFleetAgent => fleet::remove(context),
        Agents => identity::agents(context),
        Agent => identity::agent(context),
        ChangeAgent => identity::change_agent(context),
        WakePolicy => identity::wake(context),
        ChangeWakePolicy => identity::change_wake(context),
        DeliveryPolicy => identity::delivery(context),
        Rooms => rooms::rooms(context).await,
        Room => rooms::room(context).await,
        Grants => rooms::grants(context),
        Grant => rooms::grant(context).await,
        SetGrant => rooms::change(context, false).await,
        RemoveGrant => rooms::change(context, true).await,
        GrantPermissions => rooms::permissions(context).await,
        AcceptRoomInvitation => rooms::accept(context).await,
        OwnerConversation => rooms::owner_conversation(context).await,
        SetGrantPermissions => rooms::set_permissions(context).await,
        PreviewGrants => rooms::preview(context).await,
        ApplyGrants => rooms::apply(context).await,
        ListenerRuns => identity::history(context),
        ReportListener => runtime::listener_report(context),
        WakeNotice => runtime::notice(context).await,
        Policy => identity::policy(context),
        ChangePolicy => identity::change_policy(context),
        Audit => identity::audits(context),
        Release => reply::of(&context.state.release.manifest),
        Health => {
            let error = context.state.diagnostics.error()?;
            reply::of(
                json!({"instance":context.state.configuration.instance,"release":context.state.release.manifest.release,"version":context.state.release.manifest.version,"startedAt":context.state.started_at,"loggingRetentionDays":context.state.configuration.logging_retention_days,"loggingError":error}),
            )
        }
    }
}
