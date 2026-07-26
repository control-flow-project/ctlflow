export class InvocationValidationError extends Error {
  public constructor() {
    super("invocation is invalid");
  }
}
