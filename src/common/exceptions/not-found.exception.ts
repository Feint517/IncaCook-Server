import { HttpStatus } from '@nestjs/common';

import { ErrorCodes } from '@common/constants/error-codes.constants';

import { DomainException } from './domain.exception';

export class ResourceNotFoundException extends DomainException {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `${resource} with identifier "${identifier}" was not found`
      : `${resource} was not found`;
    super(ErrorCodes.NotFound, message, HttpStatus.NOT_FOUND);
  }
}
