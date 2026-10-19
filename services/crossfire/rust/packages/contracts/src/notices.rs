use crossfire_domain::messaging::BackendEvent;

pub fn mentions_agent(event: &BackendEvent, receiver: &str) -> bool {
    event.event_type == "message"
        && event.sender_backend_user_id != receiver
        && event.message_type.as_deref() == Some("text")
        && !event.edited
        && !event.control
        && event.mentions.iter().any(|identity| identity == receiver)
}
