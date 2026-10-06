import { createSchema } from '@tinqerjs/tinqer';

export type Tables = {
  enrollment_archive: {
    controller_name: string | null; controller_credential_hash: string | null; fleet_key: string | null;
    id: string; owner_id: string; verification_code: string; claim_hash: string; roster_digest: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired'; revision: number; created_at: number; expires_at: number;
    decided_by_member_id: string | null; decided_at: number | null;
  };
  enrollment_archive_item: {
    request_id: string; instance_key: string; requested_name: string; outcome: 'existing' | 'claimed' | 'failed';
    agent_id: string | null; failure_code: string | null;
  };
  enrollment_archive_policy: {
    request_id: string; instance_key: string; wake_mode: 'humans' | 'everyone' | 'selected';
    expected_agent_revision: number | null;
  };
  enrollment_archive_permission: {
    request_id: string; instance_key: string; permission_code: 'room.agent.invite'; grant_scope: 'agent_room';
  };
  enrollment_archive_wake_sender: { request_id: string; instance_key: string; sender_principal_id: string; include_agents: number };
  enrollment_archive_metadata: { enrollment_id: string; key: string; value: string };
  fleet_native_stop: { agent_id: string; receipt_id: string; sequence: number; fleet_id: string; run_id: string; connection_id: string;
    credential_id: string; native_stopped_at: number; invalidated_at: number | null };
  publication: { id: string; agent_id: string; public_key: string; title: string; state: 'staging' | 'published' | 'deleted';
    revision: number; created_at: number; expires_at: number; published_at: number | null; deleted_at: number | null;
    cleaned_at: number | null; total_bytes: number; file_count: number };
  publication_file: { id: string; publication_id: string; path: string; media_type: string; bytes: number; sha256: string; uploaded: number };
  fleet_runtime_operation: { id: string; fleet_id: string; agent_id: string | null; author_principal_id: string;
    action: 'start' | 'stop' | 'reset'; expected_revision: number; status: 'pending' | 'running' | 'succeeded' | 'failed';
    created_at: number; completed_at: number | null; error_message: string | null; connection_id: string | null; credential_id: string | null };
  enrollment_item_policy: { request_id: string; instance_key: string; wake_mode: 'humans' | 'everyone' | 'selected'; expected_agent_revision: number | null };
  enrollment_item_permission: { request_id: string; instance_key: string; permission_code: 'room.agent.invite'; grant_scope: 'agent_room' };
  enrollment_item_wake_sender: { request_id: string; instance_key: string; sender_principal_id: string; include_agents: number };
  fleet_instance_policy: { agent_id: string; approved_by_member_id: string; approved_at: number };
  fleet_instance_permission: { agent_id: string; permission_code: 'room.agent.invite'; grant_scope: 'agent_room' };
  listener_stat_checkpoint: { run_id: string; sequence: number; digest: string; captured_at: number };
  listener_stat_interval: { run_id: string; bucket_at: number; agent_id: string; started_at: number; ended_at: number; captured_at: number; dropped: number };
  listener_stat_flow: { run_id: string; bucket_at: number; room_id: string; sender_matrix_id: string; message_type: string; observed: number; delivered: number; content_bytes: number; delivered_bytes: number; attachment_bytes: number; largest_bytes: number };
  listener_stat_usage: { run_id: string; bucket_at: number; runtime: string; session_id: string; input: number; cached_input: number; cache_write_input: number | null; output: number; reasoning_output: number; total: number };
  runtime_usage_checkpoint: { agent_id: string; runtime: string; session_id: string; input: number; cached_input: number; cache_write_input: number | null; output: number; reasoning_output: number; total: number; captured_at: number };
  runtime_decision: { id: string; agent_id: string; run_id: string; runtime: string; session_id: string; request_id: string; turn_id: string; item_id: string; kind: 'permission' | 'question'; action: string; review_text: string; blocking: number; expires_at: number | null; created_at: number; status: 'pending' | 'answered' | 'responded' | 'cancelled' | 'expired' };
  runtime_decision_question: { decision_id: string; question_id: string; position: number; title: string; prompt: string; secret: number; allow_text: number };
  runtime_decision_option: { decision_id: string; question_id: string; option_id: string; position: number; label: string; description: string };
  runtime_decision_answer: { decision_id: string; question_id: string; option_id: string | null; answer_text: string | null };
  runtime_observation: { run_id: string; agent_id: string; session_id: string; room_id: string | null; runtime: string; state: 'idle' | 'working' | 'waiting-approval' | 'waiting-answer' | 'failed' | 'unavailable' | 'sleeping' | 'waking'; observed_at: number; last_activity_at: number | null; history_available: number | null; history_mode: 'shared' | 'per-room'; max_input_bytes: number; error_message: string | null };
  runtime_setting: { run_id: string; session_id: string; name: string; configured_value: string | null; effective_value: string | null };
  runtime_incident: { id: string; owner_id: string; agent_id: string | null; fleet_id: string | null; run_id: string | null; session_id: string | null; kind: 'failure' | 'contact'; message: string; created_at: number; recovered_at: number | null };
  incident_notification: { incident_id: string; phase: 'initial' | 'recovery'; body: string; next_attempt_at: number; event_id: string | null };
  management_conversation: { owner_id: string; room_id: string; created_at: number };
  agent_owner_conversation: { agent_id: string; owner_id: string; room_id: string; created_at: number };
  wake_rule: { id: string; owner_id: string; configured_by_id: string; name: string; message: string; schedule_kind: 'interval' | 'cron'; interval_seconds: number | null; cron_expression: string | null; time_zone: string | null; enabled: number; revision: number; created_at: number; updated_at: number };
  wake_rule_agent: { rule_id: string; agent_id: string; next_due_at: number; last_delivered_at: number | null };
  wake_delivery: { id: string; rule_id: string; agent_id: string; rule_revision: number; run_id: string; session_id: string; scheduled_at: number; created_at: number; status: 'pending' | 'delivered' | 'cancelled'; delivered_at: number | null };
  fleet_connection: { fleet_id: string; connection_id: string; credential_id: string; last_seen_at: number; expires_at: number; closed_at: number | null };
  fleet_message: { id: string; fleet_id: string; author_principal_id: string | null; author_credential_id: string | null; body: string; created_at: number; expires_at: number };
  fleet_message_delivery: { message_id: string; agent_id: string; status: 'pending' | 'delivered' | 'failed' | 'skipped'; completed_at: number | null; error_message: string | null };
  enrollment_controller_metadata: {
    enrollment_id: string;
    key: string;
    value: string;
  };
  fleet_controller_metadata: {
    fleet_id: string;
    key: string;
    value: string;
  };
  fleet_credential: {
    id: string;
    fleet_id: string;
    secret_hash: string;
    created_at: number;
    revoked_at: number | null;
  };
  principal: {
    id: string;
    matrix_user_id: string;
    kind: 'human' | 'agent';
    status: 'active' | 'suspended' | 'revoked';
    revision: number;
    created_at: number;
  };
  member: {
    principal_id: string;
    principal_kind: 'human';
    display_name: string;
  };
  agent: {
    principal_id: string;
    principal_kind: 'agent';
    owner_id: string;
    display_name_override: string | null;
    wake_mode: 'humans' | 'everyone' | 'selected';
  };
  agent_credential: {
    agent_id: string;
    provisioning_password: string;
    access_token: string | null;
    updated_at: number;
  };
  principal_application: {
    principal_id: string;
    applied_revision: number | null;
    applied_intent_hash: string | null;
    applied_status: 'active' | 'suspended' | 'revoked' | null;
    native_display_name: string | null;
    last_attempt_at: number | null;
    last_success_at: number | null;
    next_check_at: number;
    error_code: string | null;
    error_message: string | null;
  };
  permission: {
    code: string;
    grant_scope: 'role' | 'agent_room';
    description: string;
  };
  role: {
    code: 'member' | 'administrator' | 'agent';
    principal_kind: 'human' | 'agent';
    label: string;
  };
  role_permission: {
    role_code: string;
    permission_code: string;
    grant_scope: 'role';
  };
  principal_role: {
    principal_id: string;
    principal_kind: 'human' | 'agent';
    role_code: 'member' | 'administrator' | 'agent';
    assigned_by_member_id: string | null;
    assigned_at: number;
  };
  enrollment_request: {
    controller_name: string;
    controller_credential_hash: string;
    id: string;
    owner_id: string;
    fleet_key: string;
    verification_code: string;
    claim_hash: string;
    roster_digest: string;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    revision: number;
    created_at: number;
    expires_at: number;
    decided_by_member_id: string | null;
    decided_at: number | null;
  };
  enrollment_item: {
    request_id: string;
    instance_key: string;
    requested_name: string;
    outcome: 'existing' | 'claimed' | 'failed';
    agent_id: string | null;
    failure_code: string | null;
  };
  agent_name: {
    name: string;
    request_id: string | null;
    instance_key: string | null;
    agent_id: string | null;
  };
  fleet: {
    archived_at: number | null;
    id: string;
    delivery_enabled: number;
    label: string;
    controller_name: string;
    revision: number;
    updated_at: number;
    owner_id: string;
    fleet_key: string;
    created_at: number;
  };
  fleet_instance: {
    retired_at: number | null;
    owner_id: string;
    fleet_key: string;
    instance_key: string;
    agent_id: string;
  };
  agent_room_grant: {
    agent_id: string;
    room_id: string;
    generation: string;
    authorizer_id: string;
    added_by_id: string;
    invitation_event_id: string | null;
    admission_kind: 'managed' | 'invitation';
    access_mode: 'none' | 'read' | 'reply' | 'custom';
    power_level: number | null;
    muted: number;
    revision: number;
    access_revision: number;
    updated_at: number;
  };
  agent_room_permission: {
    agent_id: string;
    room_id: string;
    generation: string;
    permission_code: string;
    grant_scope: 'agent_room';
    granted_by_member_id: string;
    granted_at: number;
  };
  room_grant_application: {
    agent_id: string;
    room_id: string;
    observed_generation: string | null;
    applied_revision: number | null;
    applied_access_revision: number | null;
    membership: 'join' | 'leave' | 'invite' | 'ban' | null;
    creator: number;
    power_level: number | null;
    last_attempt_at: number | null;
    last_success_at: number | null;
    next_check_at: number;
    error_code: string | null;
    error_message: string | null;
  };
  agent_wake_sender: {
    agent_id: string;
    sender_principal_id: string;
    include_agents: number;
  };
  member_invitation: {
    id: string;
    created_by_member_id: string;
    claim_hash: string;
    role_code: 'member' | 'administrator';
    principal_kind: 'human';
    created_at: number;
    expires_at: number;
    consumed_by_member_id: string | null;
    revoked_at: number | null;
    claim_matrix_user_id: string | null;
    claim_display_name: string | null;
    claim_fingerprint: string | null;
  };
  member_session: {
    secret_hash: string;
    member_id: string;
    csrf_secret: string;
    native_access_token: string;
    created_at: number;
    expires_at: number;
  };
  listener_run: {
    controller_fleet_id: string | null;
    controller_connection_id: string | null;
    controller_credential_id: string | null;
    id: string;
    agent_id: string;
    release: string | null;
    started_at: number;
    last_seen_at: number;
    active_ms: number;
    messages_delivered: number;
    stopped_at: number | null;
    disconnect_requested_at: number | null;
  };
  wake_notice: {
    receiver_agent_id: string;
    event_id: string;
    sender_matrix_id: string;
    room_id: string;
    reserved_at: number;
    message_body: string;
    status: 'pending' | 'sent' | 'denied';
    sent_at: number | null;
    native_event_id: string | null;
    next_attempt_at: number | null;
    last_error: string | null;
  };
  instance_policy: {
    fleet_idle_timeout_seconds: number;
    max_message_bytes: number;
    id: 'instance';
    revision: number;
    max_owner_agents: number;
    max_agents: number;
    max_pending: number;
    enrollment_seconds: number;
    reconcile_seconds: number;
    agent_instructions: string;
    signup_mode: 'invitation' | 'open';
    invitation_issuers: 'administrators' | 'members';
  };
  audit_event: {
    id: string;
    request_id: string;
    actor_credential_id: string | null;
    actor_kind: 'human' | 'agent' | 'controller' | 'system' | 'anonymous';
    actor_principal_id: string | null;
    owner_id: string | null;
    target_kind: string;
    target_id: string;
    room_id: string | null;
    membership_generation: string | null;
    authorizer_id: string | null;
    added_by_id: string | null;
    permission_code: string | null;
    action: string;
    outcome: 'accepted' | 'rejected' | 'applied' | 'failed';
    message: string;
    created_at: number;
  };
};
export const schema = createSchema<Tables>();
