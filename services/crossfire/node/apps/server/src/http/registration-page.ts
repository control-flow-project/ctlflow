import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
const style = 'body{margin:0;background:#f8f6ef;color:#242c2c;font:18px/1.6 system-ui,sans-serif}main{max-width:32rem;margin:12vh auto;padding:2rem}h1{font-size:2rem;line-height:1.2}button{background:#f0dbe9;color:#242c2c;border:1px solid #242c2c;border-radius:4px;padding:.8rem 1.2rem;font:inherit;cursor:pointer}strong{overflow-wrap:anywhere}';
const completion = 'if(window.onAuthDone){window.onAuthDone()}else if(window.opener&&window.opener.postMessage){window.opener.postMessage("authDone",location.origin)}';
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escape(value: string) { return value.replace(/[&<>"']/gu, character => entities[character]!); }
function hash(value: string) { return "'sha256-" + createHash('sha256').update(value).digest('base64') + "'"; }
export function registrationPage(response: ServerResponse, status: number, content: { message: string } | { username: string; server: string; nonce: string; invited: boolean } | { completed: true }) {
  const confirmed = 'completed' in content;
  const title = confirmed ? 'Account confirmed' : 'username' in content ? content.invited ? 'Confirm your invitation' : 'Confirm your account' : 'Unable to continue';
  const body = confirmed ? '<p>Return to Element to finish creating your account.</p>'
    : 'username' in content ? '<p>Create <strong>@' + escape(content.username) + ':' + escape(content.server) + '</strong>' + (content.invited ? ' using your private invitation' : '') + '?</p>'
      + '<p>Your username and password are chosen in Element. Confirm this account, then return to Element to finish.</p><form method="post"><input type="hidden" name="nonce" value="' + escape(content.nonce) + '"><button type="submit">' + (content.invited ? 'Confirm invitation' : 'Create account') + '</button></form>'
      : '<p>' + escape(content.message) + '</p>';
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src " + hash(style)
      + '; script-src ' + (confirmed ? hash(completion) : "'none'") + "; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
  response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title
    + '</title><style>' + style + '</style></head><body><main><h1>' + title + '</h1>' + body + '</main>' + (confirmed ? '<script>' + completion + '</script>' : '') + '</body></html>');
}
