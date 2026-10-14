import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ModulesGraph } from '../../common/modules-graph.js';
import { AuthenticationGuard } from '../authentication/authentication.guard.js';
import { ModulesGraphService } from './modules-graph.service.js';

/**
 * Данные для страницы графа модулей. В отличие от самой страницы, данные требуют входа:
 * cookie доступа браузер отправляет на `/api`, поэтому страница получает граф только у вошедшего пользователя.
 */
@Controller('modules-graph')
@UseGuards(AuthenticationGuard)
export class ModulesGraphController {
    constructor(private readonly modulesGraph: ModulesGraphService) {}

    @Get()
    graph(): Promise<ModulesGraph> {
        return this.modulesGraph.getGraph();
    }
}
