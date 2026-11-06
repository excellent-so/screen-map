// Screen Map: an error the user can fix. The CLI prints its message alone, with no stack trace.

export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}
