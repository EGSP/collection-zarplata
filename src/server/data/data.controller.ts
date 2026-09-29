import { ArgumentsHost, Catch, Controller, ExceptionFilter, HttpCode, HttpStatus, Post, Body, UseFilters } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { DatabaseError } from '../database/database.errors.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { DataService } from './data.service.js';

/**
 * Единственное место преобразования ошибок диспетчера в HTTP: неверные данные дают 400,
 * отсутствующая цель — 404, сбой базы и непредвиденная ошибка — 500 без деталей запроса.
 */
@Catch()
export class PerformExceptionFilter implements ExceptionFilter {
    catch(error: unknown, host: ArgumentsHost): void {
        const reply = host.switchToHttp().getResponse<FastifyReply>();
        if (error instanceof DataValidationError) {
            void reply.status(HttpStatus.BAD_REQUEST).send({ error: error.message, fields: error.fields });
        } else if (error instanceof DataNotFoundError) {
            void reply.status(HttpStatus.NOT_FOUND).send({ error: error.message });
        } else if (error instanceof DatabaseError) {
            void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ error: error.message });
        } else {
            void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ error: 'Не удалось выполнить действие' });
        }
    }
}

/** Передаёт тело запроса диспетчеру без прикладной логики. */
@Controller('perform')
@UseFilters(PerformExceptionFilter)
export class DataController {
    constructor(private readonly data: DataService) {}

    /** Передаёт одну операцию или массив диспетчеру; успешный ответ всегда имеет статус 200. */
    @Post()
    @HttpCode(HttpStatus.OK)
    perform(@Body() body: unknown): Promise<unknown> {
        return this.data.perform(body);
    }
}
