/** A stable error shape shared by native and future hosted transports. */
export class CoreError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'CoreError';
  }
}
