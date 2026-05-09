import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';

import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Narrow filter — delegates to AllExceptionsFilter so that response shape is
 * unified. Useful when you want to scope HttpException handling to a single
 * controller via @UseFilters(HttpExceptionFilter).
 */
@Catch(HttpException)
export class HttpExceptionFilter extends AllExceptionsFilter {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    super.catch(exception, host);
  }
}
