import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Observable } from 'rxjs';
import { VersionInformation } from '../metadata/version-information.js';

/** Сообщает версии в ответах контроллеров, включая ошибки после прохождения guard'ов. */
@Injectable()
export class VersionsInterceptor implements NestInterceptor {
    private readonly versionsHeader: string;

    constructor(@Inject(VersionInformation) versions: VersionInformation) {
        this.versionsHeader = JSON.stringify(versions.current);
    }

    intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
        // Заголовок ставится до вызова обработчика: он сохраняется и при ошибке в pipe или контроллере.
        // Отказы guard'ов происходят раньше interceptor и по договорённости версии не сообщают.
        if (context.getType() === 'http') context.switchToHttp().getResponse<FastifyReply>().header('x-application-versions', this.versionsHeader);
        return next.handle();
    }
}
