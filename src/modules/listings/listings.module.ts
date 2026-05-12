import { Module } from '@nestjs/common';

import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  controllers: [ListingsController, BookmarksController],
  providers: [ListingsService, BookmarksService],
  exports: [ListingsService, BookmarksService],
})
export class ListingsModule {}
