// Same exception names as the NestJS services, so handlers read the same way.
export class HttpException extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request', details?: unknown) {
    super(400, message, details);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(401, message);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(403, message);
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found') {
    super(404, message);
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict', details?: unknown) {
    super(409, message, details);
  }
}

export class GoneException extends HttpException {
  constructor(message = 'Gone') {
    super(410, message);
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message = 'Unprocessable Entity', details?: unknown) {
    super(422, message, details);
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too Many Requests') {
    super(429, message);
  }
}
