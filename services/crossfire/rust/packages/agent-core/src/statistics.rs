use crossfire_contracts::validation::{truncate_utf16, utf16_length};
use crossfire_domain::statistics::{
    Batch, Flow, INTERVAL_MS, MAX_FLOWS, MAX_SESSIONS, RECENT_EVENTS, Totals, Usage,
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

const MAXIMUM: i64 = 9_007_199_254_740_991;
pub struct Event<'a> {
    pub room_id: &'a str,
    pub sender: &'a str,
    pub event_id: &'a str,
    pub message_type: &'a str,
    pub content_bytes: i64,
    pub attachment_bytes: i64,
    pub room_message: bool,
    pub listener_notice: bool,
}
#[derive(Clone, Copy)]
struct Recent {
    delivered: bool,
    order: u64,
}

pub struct Collector {
    principal: String,
    started_at: i64,
    sequence: i64,
    dropped: i64,
    flows: BTreeMap<(String, String, String), Flow>,
    usage: BTreeMap<(String, String), Usage>,
    recent: HashMap<String, Recent>,
    order: BTreeMap<u64, String>,
    position: u64,
    pending: Option<Arc<Batch>>,
}

impl Collector {
    pub fn new(principal: &str, now: i64) -> Self {
        Self {
            principal: principal.to_owned(),
            started_at: now,
            sequence: 0,
            dropped: 0,
            flows: BTreeMap::new(),
            usage: BTreeMap::new(),
            recent: HashMap::new(),
            order: BTreeMap::new(),
            position: 0,
            pending: None,
        }
    }
    fn dropped(&mut self) {
        self.dropped = self.dropped.saturating_add(1).min(MAXIMUM);
    }
    pub fn record(&mut self, event: &Event<'_>, delivered: bool) {
        if !event.room_message || event.listener_notice || event.sender == self.principal {
            return;
        }
        let previous = self.recent.get(event.event_id).copied();
        if previous.is_some_and(|value| value.delivered || !delivered) {
            return;
        }
        if !(0..=MAXIMUM).contains(&event.content_bytes)
            || !(0..=MAXIMUM).contains(&event.attachment_bytes)
        {
            self.dropped();
            return;
        }
        let prefix = truncate_utf16(event.message_type, 100);
        let message_type = if prefix.is_empty()
            || prefix
                .chars()
                .any(|value| value <= '\u{1f}' || value == '\u{7f}')
        {
            "unknown"
        } else {
            prefix
        };
        let key = (
            event.room_id.to_owned(),
            event.sender.to_owned(),
            message_type.to_owned(),
        );
        if !self.flows.contains_key(&key) && self.flows.len() >= MAX_FLOWS {
            self.dropped();
            return;
        }
        let flow = self.flows.entry(key).or_insert_with(|| Flow {
            room_id: event.room_id.to_owned(),
            sender_matrix_id: event.sender.to_owned(),
            message_type: message_type.to_owned(),
            totals: Totals::default(),
        });
        let mut totals = flow.totals.clone();
        let add =
            |first: i64, second: i64| first.checked_add(second).filter(|value| *value <= MAXIMUM);
        if previous.is_none() {
            let Some(observed) = add(totals.observed, 1) else {
                self.dropped();
                return;
            };
            let Some(bytes) = add(totals.content_bytes, event.content_bytes) else {
                self.dropped();
                return;
            };
            let Some(attachments) = add(totals.attachment_bytes, event.attachment_bytes) else {
                self.dropped();
                return;
            };
            totals.observed = observed;
            totals.content_bytes = bytes;
            totals.attachment_bytes = attachments;
            totals.largest_bytes = totals.largest_bytes.max(event.content_bytes);
        }
        if delivered {
            let Some(count) = add(totals.delivered, 1) else {
                self.dropped();
                return;
            };
            let Some(bytes) = add(totals.delivered_bytes, event.content_bytes) else {
                self.dropped();
                return;
            };
            totals.delivered = count;
            totals.delivered_bytes = bytes;
        }
        flow.totals = totals;
        if let Some(previous) = previous {
            self.order.remove(&previous.order);
        }
        if self.position == u64::MAX {
            self.order.clear();
            self.recent.clear();
            self.position = 0;
        }
        self.position += 1;
        self.recent.insert(
            event.event_id.to_owned(),
            Recent {
                delivered,
                order: self.position,
            },
        );
        self.order.insert(self.position, event.event_id.to_owned());
        if self.recent.len() > RECENT_EVENTS
            && let Some((_, expired)) = self.order.pop_first()
        {
            self.recent.remove(&expired);
        }
    }
    pub fn usage(&mut self, sample: &Usage) {
        let text = |value: &str, maximum| {
            (1..=maximum).contains(&utf16_length(value))
                && !value
                    .chars()
                    .any(|value| value <= '\u{1f}' || value == '\u{7f}')
        };
        let valid =
            sample.tokens.valid() && text(&sample.runtime, 100) && text(&sample.session_id, 255);
        if !valid {
            self.dropped();
            return;
        }
        let key = (sample.runtime.clone(), sample.session_id.clone());
        if !self.usage.contains_key(&key) && self.usage.len() >= MAX_SESSIONS {
            self.dropped();
            return;
        }
        self.usage.insert(key, sample.clone());
    }
    pub fn batch(&mut self, now: i64, force: bool) -> Option<Arc<Batch>> {
        if let Some(pending) = &self.pending {
            return Some(Arc::clone(pending));
        }
        let ended_at = now.max(self.started_at);
        if (!force && ended_at.saturating_sub(self.started_at) < INTERVAL_MS)
            || (self.flows.is_empty() && self.usage.is_empty() && self.dropped == 0)
        {
            return None;
        }
        self.sequence = self.sequence.saturating_add(1).min(MAXIMUM);
        let batch = Arc::new(Batch {
            sequence: self.sequence,
            started_at: self.started_at,
            ended_at,
            dropped: self.dropped,
            flows: std::mem::take(&mut self.flows).into_values().collect(),
            usage: std::mem::take(&mut self.usage).into_values().collect(),
        });
        self.dropped = 0;
        self.started_at = ended_at;
        self.pending = Some(Arc::clone(&batch));
        Some(batch)
    }
    pub fn acknowledge(&mut self, batch: &Arc<Batch>) {
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| Arc::ptr_eq(pending, batch))
        {
            self.pending = None;
        }
    }
}
