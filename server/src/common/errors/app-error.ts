export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) { super(message); }
}

export const notFound = (entity: string) => new AppError(404, `${entity.toUpperCase()}_NOT_FOUND`, `${entity} not found`);
export const forbidden = (message = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
