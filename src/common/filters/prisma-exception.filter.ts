import { ArgumentsHost, Catch } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AllExceptionsFilter } from './all-exceptions.filter';

@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter extends AllExceptionsFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(exception, host);
  }
}
