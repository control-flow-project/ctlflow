export class IdentityFactSourceError extends Error {
  public constructor() {
    super("identity facts are unavailable");
  }
}
