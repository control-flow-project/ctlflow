import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { API, Matrix, MatrixError, readJson, writeJson, type Account, type Settings } from '../skills/conduit-chat/scripts/lib.ts';

const DEVICE = 'CROSSFIRE_CONTROL';

// This key is server authority, not an enrollment credential. It never belongs
// in Settings, Element configuration, or an exported agent bundle.
export function controlKey(privatePath: string): string {
  const path = join(privatePath, 'control-key.json');
  if (!existsSync(path)) writeJson(path, { secret: randomBytes(48).toString('base64url') });
  const { secret } = readJson<{ secret: string }>(path);
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{64}$/.test(secret)) throw new Error('Invalid private server control key');
  return secret;
}

export class ControlMatrix extends Matrix {
  private observer: string;
  private key: string;
  private sessionPath: string;
  private renewal?: Promise<void>;

  constructor(settings: Settings, privatePath: string) {
    super(settings.homeserver);
    this.observer = settings.observer;
    // Only configure() creates the key, before Conduit reads its configuration.
    this.key = readJson<{ secret: string }>(join(privatePath, 'control-key.json')).secret;
    this.sessionPath = join(privatePath, 'control-session.json');
    if (existsSync(this.sessionPath)) {
      const saved = readJson<Account>(this.sessionPath);
      if (saved.user_id === this.observer && saved.device_id === DEVICE) this.token = saved.access_token;
    }
  }

  private async login(): Promise<void> {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const jwt = encoded({ alg: 'HS256', typ: 'JWT' }) + '.'
      + encoded({ sub: this.observer, exp: Math.floor(Date.now() / 1000) + 60 });
    const signature = createHmac('sha256', this.key).update(jwt).digest('base64url');
    const session = await new Matrix(this.base).post<Account>(API + '/login', {
      type: 'm.login.token', token: jwt + '.' + signature, device_id: DEVICE,
      initial_device_display_name: 'Crossfire coordination service',
    });
    if (session.user_id !== this.observer || session.device_id !== DEVICE || !session.access_token) {
      throw new Error('Unexpected server control identity');
    }
    writeJson(this.sessionPath, { user_id: session.user_id, device_id: session.device_id, access_token: session.access_token });
    this.token = session.access_token;
  }

  private async renew(rejectedToken?: string): Promise<void> {
    // Another request may already have replaced the token that failed. Share
    // one login across concurrent requests; logging in twice revokes the first.
    if (this.token && this.token !== rejectedToken) return;
    if (!this.renewal) this.renewal = this.login().finally(() => { this.renewal = undefined; });
    await this.renewal;
  }

  override async open(method: string, path: string, data?: Buffer, contentType = 'application/json'): Promise<IncomingMessage> {
    if (!this.token) await this.renew();
    const usedToken = this.token;
    try { return await super.open(method, path, data, contentType); }
    catch (error) {
      // Authentication rejection occurs before an operation is applied. Never
      // replay network failures, permission denials, or ambiguous server errors.
      if (!(error instanceof MatrixError) || error.status !== 401 || error.body.errcode !== 'M_UNKNOWN_TOKEN') throw error;
      await this.renew(usedToken);
      return super.open(method, path, data, contentType);
    }
  }
}
