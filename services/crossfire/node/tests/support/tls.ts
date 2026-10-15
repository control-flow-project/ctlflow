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

const certificate = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUcd0WnWmLgUpgw4ZVJMGiiK+XooEwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAwNTA5MTgzNloXDTM2MTAw
MjA5MTgzNlowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA2/u9ZBa2alkzhadfLnWXaEj+J1Txln8Hnk/fYiEMft7T
1FHMP0gKcVY5pgm/mjhUqH2bGT2tnCg/gpk8R+9VECxzK23v5FH/+jm4+hU5yXMw
3O6xeJ66+OfTzRjZ40es7Agf3scgIWNSM7RXupub9a1doGcXgteZ7RF5VDvuSCUs
ne9Xa3v1Ow56UfePqRhXYzJRMg4whsFedImtRXlzIWJmozk8QeaDc2i9iy2SYKNm
2qC2vu0hSLO5jygzCkH2tt9IhH7CrFuo8l7/TVdQSpB+SpTrmJs3fS6R9eYWGKV0
4y30YVuIUQeuVPeblPbHk3YSAf1vhcW0GW4L/Ysm1QIDAQABo28wbTAdBgNVHQ4E
FgQU93BV49RCSLgqsVnY3MzJn4uUxK4wHwYDVR0jBBgwFoAU93BV49RCSLgqsVnY
3MzJn4uUxK4wGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMA8GA1UdEwEB/wQF
MAMBAf8wDQYJKoZIhvcNAQELBQADggEBAL9vqDHFxebjh0PGu8rb4zoD7l3BWh64
IfLDPX9gE86436ySpG9HUptxuT/fxJaLKPxLJw+BPGFasGUigBzb/yxCf5ZTG0z6
EsCtE32ptdlxU11BMLlPLi3+m2oZXQAwqmxhzQNfQj909AuDM54naOFJjnuXdYIs
6Z6XYcoytarJCmxNre4hsxwsFMD172uQ4ozQtXqHjeLPrmRw31mDaGkrJwxWpmyv
C7plZqVx9GHKaLHBawVre1nGVmhwSzoUmKpoDP3feIXa/KU4Np5sLAdnv1bsd6w6
UGK/9LgkeXagSWrlTHQA7BRzNeYAuOPAcEIQ4nlmaPJ92PiAE3UqEk4=
-----END CERTIFICATE-----`;
const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDb+71kFrZqWTOF
p18udZdoSP4nVPGWfweeT99iIQx+3tPUUcw/SApxVjmmCb+aOFSofZsZPa2cKD+C
mTxH71UQLHMrbe/kUf/6Obj6FTnJczDc7rF4nrr459PNGNnjR6zsCB/exyAhY1Iz
tFe6m5v1rV2gZxeC15ntEXlUO+5IJSyd71dre/U7DnpR94+pGFdjMlEyDjCGwV50
ia1FeXMhYmajOTxB5oNzaL2LLZJgo2baoLa+7SFIs7mPKDMKQfa230iEfsKsW6jy
Xv9NV1BKkH5KlOuYmzd9LpH15hYYpXTjLfRhW4hRB65U95uU9seTdhIB/W+FxbQZ
bgv9iybVAgMBAAECggEACyO4TMqJpOECJuZ5f2oc/KmVlSWhW4mbN9JmRsXS/X8I
eFvxXShSFGMqutRg4M0Gxxwf2oCxEJNJLrKBHEjA+fdbmFC828b7O2STkAu7HWRj
47bX7c+75WwijDmR7wcWI+2quiaYje2a9VtQhfaTSIw64tXVmZ6UANk9rPJL+AMx
0Zm6K5OAIScguWO8VTWqmV0I8WFn/lupmQ18VtSN6f72pd+2cbswNOAWCcaoQHMK
QhP+7STLDE0l3DC4pUreziyX4IZMKh2sXCvkuI3V4XJUMKifkn7EMCQSoD7ir5HZ
0MG40j8cWBHtEVAZBkqXVY25eADF5dcTl0bfKxuaEQKBgQD8SSZvhBFd+mMuiBVp
OoVV1W0JLNReyZHeKb7yCKpfgs+2Pqb29kiIEMbpiZMkV+doYSpHP8K6Sj+xWou4
Ft+X+c3js7Qs5o+5++9zxh6MMICJ7Kp41T/WhlooTatX9JcWYfnSGSBZLFvXzzkm
H5+JaXsJ12O4KhYiazFsafz/jwKBgQDfONgK+p+vebTsGIe2dJdXM7M1Axcno5oP
Tg0RGFSFlsqXVcjCDAf58MB1i/03saxBI7cnuHnkfhQBubWDBgm0IOGdZq97TsHe
XSp2TlpQWF/zUEbKxSF4tF3rOg+GNJLxLU/ISeHPqAtnMRv6KNkfgLTb6M6+j9wY
wAvJFDdBWwKBgQCfkvFRxfpqNA76Bq9sUMy3nviJviZSEjNGj6csVljVcttJDdX0
DZGRJvN6Ej/U1BkVx6fDS0wzIvWoi3ompakl6qbVKPyFDgzI+dbapuz5hVA4bU7i
gRgQ7Agox//h8V6DlNM8lhIE9W7eUT93orb5ZpOhhPCZM12uxZiMV3nkdwKBgCBR
CnYMcrHk3NyRcJRprL9jLL6wA9opRVSR6DJhY1szyYC/WqE9PKpiwHpEGhTGFDoa
AZouivcZiav2RuEBLsZ1PDSdeSpQ7KBUvKEEFu8q3DlNlfIlOANRmYdEkJrNYbio
5rQIfjiiC4SVB4fgAg8dgxGTUtsj2Kl8pDgoRRehAoGAOXOGKEtlVPxI8KQy9E8m
Qg4G7ChcsXRaRnW2R4MGtB7wkMDNR2ZS4ywFTImdZO+P1bJxKYuH83qT6Bbo58ga
iIc+bQiSEjwJnAF1rcf0zEINljQlDGy/PlwmEYnD+leq9YNo3JPjRXFAa+qlUh1z
QN1/jAN6UBjpvW39ko7fEik=
-----END PRIVATE KEY-----`;
const publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });

export const browserOptions = { executablePath: process.env.CROSSFIRE_BROWSER ?? '/usr/bin/google-chrome', headless: true,
  args: ['--ignore-certificate-errors-spki-list=' + createHash('sha256').update(publicKey).digest('base64')] };

function trustCertificate(scope: Scope) {
  const previousFile = process.env.NODE_EXTRA_CA_CERTS, previousSslFile = process.env.SSL_CERT_FILE, authorities = getCACertificates('default');
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-test-tls-')), file = join(directory, 'authority.pem');
  writeFileSync(file, certificate + '\n' + (previousFile ? readFileSync(previousFile, 'utf8') : ''), { mode: 0o600 });
  process.env.NODE_EXTRA_CA_CERTS = file;
  process.env.SSL_CERT_FILE = file;
  if (!authorities.includes(certificate)) setDefaultCACertificates([...authorities, certificate]);
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
