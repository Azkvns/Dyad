export class HttpError extends Error {
  readonly statusCode: number;
  readonly body: { error: string; fields?: Record<string, string> };

  constructor(statusCode: number, body: { error: string; fields?: Record<string, string> }) {
    super(body.error);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.body = body;
  }
}
