use crossfire_domain::statistics::*;
use serde::{
    Serialize, Serializer,
    ser::{SerializeSeq, SerializeStruct},
};

pub struct TokensWire<'a>(pub &'a Tokens);
pub struct FlowWire<'a>(pub &'a Flow);
pub struct BatchWire<'a>(pub &'a Batch);
struct FlowsWire<'a>(&'a [Flow]);
struct UsageWire<'a>(&'a [Usage]);

impl Serialize for TokensWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("Tokens", 6)?;
        value.serialize_field("input", &self.0.input)?;
        value.serialize_field("cachedInput", &self.0.cached_input)?;
        value.serialize_field("cacheWriteInput", &self.0.cache_write_input)?;
        value.serialize_field("output", &self.0.output)?;
        value.serialize_field("reasoningOutput", &self.0.reasoning_output)?;
        value.serialize_field("total", &self.0.total)?;
        value.end()
    }
}

impl Serialize for FlowWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("Flow", 9)?;
        value.serialize_field("roomId", &self.0.room_id)?;
        value.serialize_field("senderBackendUserId", &self.0.sender_backend_user_id)?;
        value.serialize_field("messageType", &self.0.message_type)?;
        value.serialize_field("observed", &self.0.totals.observed)?;
        value.serialize_field("delivered", &self.0.totals.delivered)?;
        value.serialize_field("contentBytes", &self.0.totals.content_bytes)?;
        value.serialize_field("deliveredBytes", &self.0.totals.delivered_bytes)?;
        value.serialize_field("attachmentBytes", &self.0.totals.attachment_bytes)?;
        value.serialize_field("largestBytes", &self.0.totals.largest_bytes)?;
        value.end()
    }
}

impl Serialize for FlowsWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for flow in self.0 {
            sequence.serialize_element(&FlowWire(flow))?;
        }
        sequence.end()
    }
}

impl Serialize for UsageWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Sample<'a> {
            runtime: &'a str,
            session_id: &'a str,
            tokens: TokensWire<'a>,
        }
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for sample in self.0 {
            sequence.serialize_element(&Sample {
                runtime: &sample.runtime,
                session_id: &sample.session_id,
                tokens: TokensWire(&sample.tokens),
            })?;
        }
        sequence.end()
    }
}

impl Serialize for BatchWire<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut value = serializer.serialize_struct("Batch", 6)?;
        value.serialize_field("sequence", &self.0.sequence)?;
        value.serialize_field("startedAt", &self.0.started_at)?;
        value.serialize_field("endedAt", &self.0.ended_at)?;
        value.serialize_field("dropped", &self.0.dropped)?;
        value.serialize_field("flows", &FlowsWire(&self.0.flows))?;
        value.serialize_field("usage", &UsageWire(&self.0.usage))?;
        value.end()
    }
}
