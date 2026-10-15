import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { createServer as createHttpServer, request as forward, type Server } from 'node:http';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';

type Scope = Parameters<typeof cleanup>[0];

const authority = `-----BEGIN CERTIFICATE-----
MIIDTDCCAjSgAwIBAgIUC+eR9KTFssawf54jQl8A/6+hL2AwDQYJKoZIhvcNAQEL
BQAwLDEqMCgGA1UEAwwhQ3Jvc3NmaXJlIGlzb2xhdGVkIHRlc3QgYXV0aG9yaXR5
MB4XDTI2MTAxNTAxNTk1OFoXDTM2MTAxMjAxNTk1OFowLDEqMCgGA1UEAwwhQ3Jv
c3NmaXJlIGlzb2xhdGVkIHRlc3QgYXV0aG9yaXR5MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAmJ2S3lniPfz5ayPR6kUN92tMhKbEsLZfduIJf18NZLeb
gmmEf59FbGtsHHhl/uuiwmabgIJHgCh064lt0oLC2zlaymuHZ7qwIOqUzmjQ4lz2
MUOgOw7qsE4tInPhtQKcmOXgfX8lW/9IRYVtozwPzChXPrH933FMdFD8nwSviuaM
5vbZX88LUYE0OfhID+Acuph2qz6txsbB4P8/Xp+aZwyBUU2NoHwY4vjZv+DLXxw2
GwknuEMcCVp8upIJJmBSETGFimrn6YG+OZFVSfSU9tY4gfFtXwFk83R2yuUfCMsO
qY/jNlphkAJKLmq7qkv2d5AYhXJ60owl6F29RKbWbwIDAQABo2YwZDAdBgNVHQ4E
FgQUHPzTpvpEZ8eRw/r9gB6SmauTCc0wHwYDVR0jBBgwFoAUHPzTpvpEZ8eRw/r9
gB6SmauTCc0wEgYDVR0TAQH/BAgwBgEB/wIBADAOBgNVHQ8BAf8EBAMCAQYwDQYJ
KoZIhvcNAQELBQADggEBAAPhNLMLKr02AYfRdwW1GIO8cTAA5rfXfjxkoTdO3VXm
OU8xk/euUJudRG3H/z4mZ8ffjrzybwpQGJXZKCa6LuiXtOuHOyXzjUBJLbrQimWp
NyXW0F6Mk5Z6LzhsrbkINQca9qcDumrHZ+GlQXzsX7Ao4pq98NZQXAK/+CnUGqBr
ZoKfvOtqHTOmNdwUmdGcTmUfTpBRpZE9Hocu8cX3s+YHyqn62yxK/JcmAPpu898l
HHtGIAYAJC1rVAnIL9oXYs8CIuFIylu2TKjgkiNeR1E3GrKDxszj77oOfB2Dp6Jj
Y/Ergg9ZwC4HDXzDSz4eOaajzrAEIUF6arzC0IVc8lM=
-----END CERTIFICATE-----`;
const certificate = `-----BEGIN CERTIFICATE-----
MIIDYTCCAkmgAwIBAgIUf2Y7Yx2mENKS3ZMbzbXNKPupirwwDQYJKoZIhvcNAQEL
BQAwLDEqMCgGA1UEAwwhQ3Jvc3NmaXJlIGlzb2xhdGVkIHRlc3QgYXV0aG9yaXR5
MB4XDTI2MTAxNTAxNTk1OFoXDTM2MTAxMjAxNTk1OFowFDESMBAGA1UEAwwJbG9j
YWxob3N0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA01Wjc90ji3vg
g1+l3HQ3jrRe8XnyazGyrGwtN/9HBMBSItIVjLL9V01tNqGTMDPLrUzVaxYWGV/3
nQuyQ35F38KI+S9awirV7bNeCSKxKmGTzn1EARYNOPeCDWM0cORs5wEgPL94SylJ
VXF+Gmt5Hif/wYjCRxrNwj29bUHsdzcSs2nOmeQAHw8sX86cQvB9tt4Fpo4xk1T5
NnGHDQREeLNCenhKidoPKGueTFqpKMIRQImn1W4frs1e9sgEBaLlg9x3lX3IBrXE
NkniZQ0OspAmnA/QxIZOPZZW8BGzcWVZYONLZiF+DOgv7Kz4MuS0RYaV8CFoSk/9
LyRoysyfCQIDAQABo4GSMIGPMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATAM
BgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIFoDATBgNVHSUEDDAKBggrBgEFBQcD
ATAdBgNVHQ4EFgQUbaeyushDpBkg+W846hwT4lCq+CcwHwYDVR0jBBgwFoAUHPzT
pvpEZ8eRw/r9gB6SmauTCc0wDQYJKoZIhvcNAQELBQADggEBAE/do4dzYv4l8z67
P8z/VMb42kehHgn66hf8AP4Av1egtDc/3LxJfv238h+eyRmk5Q8dn9XZC0oynigP
XWZh8LIG2cZxEIaaVTIXm0y4eax+QxkKqe2kjHStag0AlG6/hvR2q9BG5C0J+Mw3
g5lis50fXQxT0RxyJWpBGMoLhLcfHNToqmqC/8unMqXRL8F2kN0RPeK8qXn8cGIz
7Yb4lh5pJQvCfkDsnQD15PGpvoDpK2q8e5n7iWoUC5MmDyIQisUmISBvij0the9j
a6aUIuE6LB7GSljnhLJiQytMY9u0NZTvY6akPnCi300N7KnvmFxZHJuuyYypl89B
O7WVSTg=
-----END CERTIFICATE-----`;
const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDTVaNz3SOLe+CD
X6XcdDeOtF7xefJrMbKsbC03/0cEwFIi0hWMsv1XTW02oZMwM8utTNVrFhYZX/ed
C7JDfkXfwoj5L1rCKtXts14JIrEqYZPOfUQBFg0494INYzRw5GznASA8v3hLKUlV
cX4aa3keJ//BiMJHGs3CPb1tQex3NxKzac6Z5AAfDyxfzpxC8H223gWmjjGTVPk2
cYcNBER4s0J6eEqJ2g8oa55MWqkowhFAiafVbh+uzV72yAQFouWD3HeVfcgGtcQ2
SeJlDQ6ykCacD9DEhk49llbwEbNxZVlg40tmIX4M6C/srPgy5LRFhpXwIWhKT/0v
JGjKzJ8JAgMBAAECggEAFs7aSinmqSoga+1JuEYurM8YpBUWLa16bBNsuetqHcAn
3SwxOTMkFmT70XaUrRIZ/EUbj2gd0HVEAwX9Ij2hiumy4LnUoLoAxpuiHXhKCJnp
WtK4ISnhGXHU7l7zjO+KNVAwy32anPoCuR77jhxlQPTuLFP3K7df14PUStNfkuoD
SpWKBjLUm1jJGJkwss7XjeAVDTFbC+PeizdkAVaJkPLawTt9pkXl+7L20Nl+7SgA
8bSoXNZDiYTED8sOytHLriWdWTSriEusvK8uKv3DPP9b+feds/+exP/+txWjd52H
6mHOTmMFWq44bPpVxaz/TfGH05Li075GAwXixJVVgQKBgQD+GHGQ2f+wg/hZ+eYj
4mr8H0hvIAeB7cTMa59AaKjBcy168ru9WHk2EZxNCMGw320JN711yV6ZapeHDWnH
suJXH+DnNuQ9zSBr4U4YfzSlpvWSEKff4LvPvIdhp9ABBvbR3g8HLohhA2Pf5UGg
Wuegxkq+4vl+Bj8QRc7YH5ZS0QKBgQDU6yU+l26mwSaopwwAgK2rHenQY8PhqGzx
SUkXvpQWIetsPvEJfdYbcn23syLXQQKT70JUhaZUzBJQ7IyBrOPdCso/8/i9VQLL
YS8UtF7mGqzSrYP3kD5cBmfTHL0ZMoxewoEj45R9brsIuDxMzdzT+o13Pf3zp05t
iLx431PmuQKBgC0VUTEOPNuozqvINxku1yScuFFfMXXQJhbPEZZv+2E3el5SKxVR
WVBKl5zjbNphCguUpDz92ZcG3pPLwXT5PEeRFGpxxtVgS9xYQW7/QuwRT4j3A5Ip
YaleHfcpuzIzdh+OcsQncXMlEtdq6dX1yxsvk5uC0hmWKiJNAIJAOH/BAoGBAMEo
vnYlLWYsrmSsf0/pbSRjE95Q08DhakwPfzcCVxgpF4nxI/zHYzktSe4gnogHW05X
7aX+RaKCLE+r+eAet+2tP0R7kfo5qDpX5T10UO+R3Z2XerRZ8KjNyt0UIl08pWnG
LSAg83JDxXwon9PRovfQQwydecjUzGrEdK93c4dJAoGAJ11p25eK5kspvavHeSK5
wwPlzrcYrYLRbzn0aanakelwlZ+dd7UI+KBZ6tCmkd8VMqQdeFV2E0qKaAqCfeg8
LiKVH9qjU/Fn0aFhb0lXuOrwJyfVJsEsfAlU9lR8B6rnDhZvIUdGSo7EvFNs0tpG
dc+bfTVw3PnUnoM0Gykjy/M=
-----END PRIVATE KEY-----`;
const publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });

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
      path: request.url, headers: request.headers, timeout: 30000 }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.on('error', () => response.destroy()); incoming.pipe(response);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Fixture proxy deadline')));
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('error', () => upstream.destroy()); response.on('close', () => upstream.destroy()); request.pipe(upstream);
  }));
}
