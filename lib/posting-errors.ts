export class PostingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingConflictError";
  }
}

export class PostingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingValidationError";
  }
}
