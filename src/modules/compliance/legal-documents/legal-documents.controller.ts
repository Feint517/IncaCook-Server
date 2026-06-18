import { Controller, Get } from '@nestjs/common';

import { Public } from '@common/decorators/public.decorator';

import { LegalDocumentsService, LegalDocumentView } from './legal-documents.service';

/** Public (mobile) read of the active CGU/CGV documents. No auth — the legal
 *  text is shown at signup before a session exists. */
@Controller({ path: 'legal-documents', version: '1' })
export class LegalDocumentsController {
  constructor(private readonly service: LegalDocumentsService) {}

  @Public()
  @Get('active')
  active(): Promise<LegalDocumentView[]> {
    return this.service.activeAll();
  }
}
