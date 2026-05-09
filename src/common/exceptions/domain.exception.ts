import { HttpException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '@common/constants/error-codes.constants';

export class DomainException extends HttpException {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ code, message, statusCode: status }, status);
    this.code = code;
  }
}
