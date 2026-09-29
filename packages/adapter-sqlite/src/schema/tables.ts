import { createSchema } from '@tinqerjs/tinqer';

export type Tables = {
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
    wake_mode: 'nobody' | 'owner' | 'owner-agents' | 'humans' | 'everyone' | 'selected';
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
    id: string;
    owner_id: string;
    fleet_key: string | null;
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
    owner_id: string;
    fleet_key: string;
    created_at: number;
  };
  fleet_instance: {
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
    id: 'instance';
    revision: number;
    max_owner_agents: number;
    max_agents: number;
    max_pending: number;
    enrollment_seconds: number;
    reconcile_seconds: number;
    agent_instructions: string;
  };
  audit_event: {
    id: string;
    request_id: string;
    actor_kind: 'human' | 'agent' | 'system' | 'anonymous';
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
