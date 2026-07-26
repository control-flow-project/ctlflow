export class InvocationKeySourceError extends Error {
  public constructor() {
    super("invocation key source is unavailable");
  }
}
