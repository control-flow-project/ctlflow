import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { createServer as createHttpServer, request as forward, type Server } from 'node:http';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { cleanup } from './cleanup.js';

type Scope = Parameters<typeof cleanup>[0];

const authority = `-----BEGIN CERTIFICATE-----
MIIDPzCCAiegAwIBAgIUTCqR0IoHdO5NVNC6m1UUfi1IfVowDQYJKoZIhvcNAQEL
BQAwJzElMCMGA1UEAwwcQ3Jvc3NmaXJlIGNvbnRyYWN0IGF1dGhvcml0eTAeFw0y
NjEwMTYwODUwMTdaFw0zNjEwMTMwODUwMTdaMCcxJTAjBgNVBAMMHENyb3NzZmly
ZSBjb250cmFjdCBhdXRob3JpdHkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCt+xq+UF4iYUe8AMQx4Rc9gw08ecudslItB+66YwxOCLUlFBt5F3esvMPw
KkFp0VFHyzPSuFMihBEwcBXg9jPshQYC3bQmykZL3XIZvC81xdnNckirdVuvQxzf
XTzvS/2a2Sdb58584elSUpJ0Lhgb5JTuF0MTw9L8nVx8skxkrWjwj4pFzJMqn6AP
fHtYV5SyTFKmZSKv5ySaCrGI5LzYoHgA5fZMMMXnLaZy9K7Tit4/ImTlqSFsYn6Q
ZtHWoPHBEG1KqIzffhrtYV2w4qSZYqWda5jLOgjFKWHhO9fSncdKxy0eGizgFd3M
bDVhb8jZwAR/nYLfbeCT1qaR3TnXAgMBAAGjYzBhMB0GA1UdDgQWBBTS33lhZegw
KRl7wuwZUOmEsmwXBzAfBgNVHSMEGDAWgBTS33lhZegwKRl7wuwZUOmEsmwXBzAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOC
AQEAkoekxhy71wSO/umT1H8SBUlwbW8eXHq2hT/JhvHWWlvkPK11e6YW0n1+y4aq
ivFyoiQbTbN2L1uP0E3viHN0aMmVXq3yG6zQbg8K+/XnUw3CWJ+ljJjIRzz+VzE3
3ZMy6g+KyVAgaQry/2JpQx3h9yuwkDQgCQQsdmqajDa9z3otTr6oyVCaNF9R99Sx
LyGuvstXI/bmOu0HRoEJ8kB8YhshUjJ6TXYVf6qx+Gv+Cw5YUbypnjEfeDgElORG
8WczKlHdvzv0UCVcNl8GG3/AEuBmxVJRtkISabxm2piiZCv/l5YM1Y3EPlZCQu9S
nA+IaCxy1R40Sb9JYYZwUtBuKg==
-----END CERTIFICATE-----`;
const certificate = `-----BEGIN CERTIFICATE-----
MIIDXDCCAkSgAwIBAgIUPWmNZOIdbVUaeGjm+pl/7uXw08gwDQYJKoZIhvcNAQEL
BQAwJzElMCMGA1UEAwwcQ3Jvc3NmaXJlIGNvbnRyYWN0IGF1dGhvcml0eTAeFw0y
NjEwMTYwODUwMTdaFw0zNjEwMTMwODUwMTdaMBQxEjAQBgNVBAMMCWxvY2FsaG9z
dDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAK7jbNEt9uRXJ8qgNFRQ
gX1Fun8BkZWyK8BkIgn+hHNFwgQA/RJe/YXTS3ZN7fWpdX8UBYZj/4mmDcI3JvYL
b2+SYFuW75OJtKlC3uLud2yxF569KlDcoAyUFksgdHzD6Zuqp2IJWjlH4rcqnAZk
ujtyAJOX4pXEI5lvatTS1CCuIRPFKCQjxjfMKxco3SiWraFRH4hSZDpgPYIGL9i6
kxVFeyM6XWiOFbG7Ea8A0YrUG4eD7C6PaYaHa17LZhIlho50xv8P4wtF33zGL0xk
1cqzacMGOIP9o8QaNWTPzfsV8xwXHKmmYM+6kryZLCvbseQiaH/GXGGKvDUUwXTM
wykCAwEAAaOBkjCBjzAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIFoDATBgNV
HSUEDDAKBggrBgEFBQcDATAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwHQYD
VR0OBBYEFEAI9f2I88+w7uNERehCk0rpL1f3MB8GA1UdIwQYMBaAFNLfeWFl6DAp
GXvC7BlQ6YSybBcHMA0GCSqGSIb3DQEBCwUAA4IBAQAzd2kSyyxTbqbiyxFinGd9
9Te+A+nOS89tt6+Hv0rMkv79VYHD6j2DEVgqUZ9mNY6uk55HJv0QHDW0mR8ChGv1
ELC6gYbott44ipPG8GnDbFrTKv8A4rmWQvVCw1y6l+l5LEW2rxKUH2CQqMkOegjp
wAtFUA9FogFZwCGHcONXC2e6MpnTUgfodsmb+6mBnJYaWHNd8je7n0hKRu7uM8Sx
r9TgbiQgrxK1YzCt8nNVqtFBzAr8ZW5V8cvi1zhy/Z6FCkCwYjhVngZnSS1jiXKY
nGq/X6RU8521herc0bUWR0ynAT2r9bFCeSTxcICmiWT5EsmDjd522tdRa9wspqT2
-----END CERTIFICATE-----`;
const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCu42zRLfbkVyfK
oDRUUIF9Rbp/AZGVsivAZCIJ/oRzRcIEAP0SXv2F00t2Te31qXV/FAWGY/+Jpg3C
Nyb2C29vkmBblu+TibSpQt7i7ndssReevSpQ3KAMlBZLIHR8w+mbqqdiCVo5R+K3
KpwGZLo7cgCTl+KVxCOZb2rU0tQgriETxSgkI8Y3zCsXKN0olq2hUR+IUmQ6YD2C
Bi/YupMVRXsjOl1ojhWxuxGvANGK1BuHg+wuj2mGh2tey2YSJYaOdMb/D+MLRd98
xi9MZNXKs2nDBjiD/aPEGjVkz837FfMcFxyppmDPupK8mSwr27HkImh/xlxhirw1
FMF0zMMpAgMBAAECggEACQFH1Jt/x3EfaOUH3MGKcVdaS3jatLEIZK8jO42B52eT
nl4oqb3/Ytkm3RAVLR2NIb53rFxQx5cnxTTOykN7eOy6Dm0+p8Oi7EY3sMqjlpKl
yzQlTiWWDh+/6B1jMhtqV2wZk0g0/5cOeuz0PLYKCs6Lbg4Xiiufw6JDh3LVnlsT
KZAM2Hi4GyZfp/1z/5qYZ0sc7wWQ7hmgi5mtpbDGtZR7u8/RpLhfYchQUM++xack
BBzIQym6QrDTTfAPeUKqiBGcapZRnBJbTD19E9QIM6yF6JM/LO/R9qe8MDGK8cQH
Aw24c7MMeLzaMSwVdg2UUolloaN67vi+UI6YEqmcqQKBgQDU3Ep44qKJDXRgDWiq
Yao+ciYqwRtyoAJopbvcw9ipUCcAIC9okUL7meACOuCNNXyng9Rl4go5epVKekg7
iB5KhI4AIrcvx3CHKdkgJNnu/U89A/BZe9JLEZctH1eUZMKLA8cov0j79iwUzKKI
HhjkjhwN0M5uUu1r4qMlIuWtHQKBgQDSVQy6XkCFli8RwLlo0z6Egp2ujoHJTpzm
jqpZMtD3If+xuYcIrRy96GN0avrcLlrHQUOLAa6dXx+IbQAU2x2EIPP6ZQiwDJHW
Nh0/AAJ1owrqZY4iFLmY6tM7QbwcqPPMTdDrbMX/BRPTn3OnMRJ3wO/shw5XjGHQ
vEecTOtsfQKBgH8JbiTRVaGn9wFwXzv4h8s3AxJXJ5N0bZuY9hKei8sYu/32N3UX
5LsWLbwG+YctGdU792JK0kFVqI3Hhx6IcVOV4s2v6lZImB8C2cO2Wp6obUcD98jf
/jSxLeFPKEy3Ceg/e/gUmXFOjSZorsO/+qlFKvcP3HO5aFsP6sA6IIr9AoGANXBs
cnF9/TLiNKV9thdt2+b/vxjv+sChdqaqu00A8LlPqM0VdOve0JVZp3uCzyxr3hJD
4e6EefFwJo5jJelh/28L7gN7iJc4+m73UUlkVpUdMd6plRkk6qhHENgrvjBi+PaQ
bTBOwfN9TRhHHySFp616h+LsjuvY8lrT6u9UJVUCgYEAyA3NDmFKwmzrHc6cZQWi
MHXmQJYDcw7CShP4NSNPdEC4z92aVG4/+uANSgpeZHq25S4XiaeabvYsIzh4j8F1
xgzdkqqMojC2+q3CtBPqSJJ7l3bTs3+vrZhUBx7Is+qi3Z3RxD1H/4cphyxuft3x
bl4cjGpP0oEnyphbbU7iwPE=
-----END PRIVATE KEY-----`;
const publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });
assert.equal(new X509Certificate(authority).ca, true, 'The shared fixture trust anchor is a CA');
assert.equal(new X509Certificate(certificate).ca, false, 'The HTTPS server certificate is not a CA');
assert.equal(new X509Certificate(certificate).verify(new X509Certificate(authority).publicKey), true, 'The fixture server chain verifies');
assert.equal(new X509Certificate(certificate).checkIP('127.0.0.1'), '127.0.0.1');

export const browserOptions = { executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true,
  args: ['--ignore-certificate-errors-spki-list=' + createHash('sha256').update(publicKey).digest('base64')] };

function trustCertificate(scope: Scope) {
  const previousFile = process.env.NODE_EXTRA_CA_CERTS, previousSslFile = process.env.SSL_CERT_FILE, authorities = getCACertificates('default');
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-test-tls-')), file = join(directory, 'authority.pem');
  writeFileSync(file, authority + '\n' + (previousFile ? readFileSync(previousFile, 'utf8') : ''), { mode: 0o600 });
  process.env.NODE_EXTRA_CA_CERTS = file;
  process.env.SSL_CERT_FILE = file;
  if (!authorities.includes(authority)) setDefaultCACertificates([...authorities, authority]);
  cleanup(scope, () => { setDefaultCACertificates(authorities);
    if (previousFile === undefined) delete process.env.NODE_EXTRA_CA_CERTS; else process.env.NODE_EXTRA_CA_CERTS = previousFile;
    if (previousSslFile === undefined) delete process.env.SSL_CERT_FILE; else process.env.SSL_CERT_FILE = previousSslFile;
    rmSync(directory, { recursive: true, force: true }); });
  return directory;
}

export function browserExecutable(scope: Scope) {
  const directory = trustCertificate(scope), file = join(directory, 'chrome');
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(file, '#!/bin/sh\nexec ' + [browserOptions.executablePath, ...browserOptions.args].map(quote).join(' ') + ' "$@"\n', { mode: 0o700 });
  return file;
}

export async function secureRouter(scope: Scope, router: Server) {
  trustCertificate(scope);
  const server = createServer({ cert: certificate, key, requestTimeout: 30000, headersTimeout: 10000 },
    (request, response) => { router.emit('request', request, response); });
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  return { server, origin: 'https://127.0.0.1:' + address.port };
}

export function secureProxy(scope: Scope, destination: string) {
  const target = new URL(destination); assert.equal(target.protocol, 'http:'); assert.equal(target.hostname, '127.0.0.1');
  return secureRouter(scope, createHttpServer((request, response) => {
    const upstream = forward({ hostname: target.hostname, port: target.port, method: request.method,
      path: request.url, headers: { ...request.headers, 'x-forwarded-for': request.socket.remoteAddress }, timeout: 30000 }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.on('error', () => response.destroy()); incoming.pipe(response);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Fixture proxy deadline')));
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('error', () => upstream.destroy()); response.on('close', () => upstream.destroy()); request.pipe(upstream);
  }));
}
