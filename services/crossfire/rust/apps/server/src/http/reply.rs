use crossfire_adapter_http::server::{self, Body, Response, header};
use crossfire_contracts::envelope::{Metadata, Response as Envelope, metadata};
use crossfire_domain::identity::Page;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::Serialize;
use serde_json::Value;
pub struct Reply {
    pub data: Value,
    pub pagination: Option<(i64, i64, i64, i64)>,
    pub cookies: Vec<hyper::header::HeaderValue>,
}
pub fn of<T: Serialize>(value: T) -> Result<Reply> {
    let data = serde_json::to_value(value)
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Response cannot be encoded"))?;
    Ok(Reply {
        data,
        pagination: None,
        cookies: Vec::new(),
    })
}
pub fn page<T>(value: Page<T>, project: impl Fn(&T) -> Result<Value>) -> Result<Reply> {
    let data = value
        .items
        .iter()
        .map(project)
        .collect::<Result<Vec<_>>>()?;
    let mut reply = of(data)?;
    reply.pagination = Some((
        value.page,
        value.page_size,
        value.total_items,
        value.total_pages,
    ));
    Ok(reply)
}
pub fn response(reply: Reply, request_id: &str, status: u16) -> Result<Response<Body>> {
    let mut meta: Metadata = metadata(request_id.to_owned());
    if let Some((page, size, items, pages)) = reply.pagination {
        meta.page = Some(page);
        meta.page_size = Some(size);
        meta.total_items = Some(items);
        meta.total_pages = Some(pages);
    }
    let bytes = serde_json::to_vec(&Envelope {
        data: reply.data,
        meta,
    })
    .map_err(|_| Failure::new(ErrorCode::Unavailable, "Response cannot be encoded"))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(Failure::new(
            ErrorCode::Limit,
            "Response exceeds its resource bound",
        ));
    }
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(server::full(bytes))
        .map_err(|_| Failure::new(ErrorCode::Unavailable, "Response cannot be constructed"))?;
    for cookie in reply.cookies {
        response.headers_mut().append(header::SET_COOKIE, cookie);
    }
    Ok(response)
}
