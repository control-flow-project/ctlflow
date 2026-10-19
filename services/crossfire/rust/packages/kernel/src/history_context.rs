pub const MAXIMUM_LENGTH: usize = 260;

pub fn for_room(room: &str) -> String {
    format!("room/{room}")
}
pub fn room(context: &str) -> Option<&str> {
    context.strip_prefix("room/")
}
pub fn valid(context: &str) -> bool {
    matches!(context, "shared" | "control") || room(context).is_some_and(crate::identifier::opaque)
}
