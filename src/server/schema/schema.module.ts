import { Module } from '@nestjs/common';
import { SchemaService } from './schema.service.js';

/** Подключает синхронизацию структуры к жизненному циклу приложения Nest. */
@Module({ providers: [SchemaService] })
export class SchemaModule {}
