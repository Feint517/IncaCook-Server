import { HttpStatus } from '@nestjs/common';

import { ErrorCode } from '@common/constants/error-codes.constants';

import { DomainException } from './domain.exception';

export class BusinessRuleException extends DomainException {
  constructor(code: ErrorCode, message: string) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
