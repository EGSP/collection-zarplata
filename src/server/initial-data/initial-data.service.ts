import { Inject, Injectable, Logger } from '@nestjs/common';
import { Effect } from 'effect';
import { AuthenticationService } from '../authentication/authentication.service.js';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { DataService } from '../data/data.service.js';
import { Database } from '../database/database.effect.js';
import { DatabaseService } from '../database/database.service.js';
import { ServerPort } from '../settings/server-port.js';
import { SettingsService } from '../settings/settings.service.js';
import { InitialDataError } from './initial-data.errors.js';
import { importServerAddress, runImportTool } from './import-tool.js';
import { createInitialUsers } from './initial-users.js';
import { ownInstallmentRateOperations } from './own-installment-rate.js';
import { randomEmployeeOperations } from './random-employees.js';

/** Сколько случайных сотрудников создаётся из загруженных физических лиц. */
const randomEmployeeCount = 4;

/**
 * Применение первичных данных: начальные пользователи, импорт справочников из выгрузок 1С
 * и, по настройке, случайные сотрудники для демонстрации.
 *
 * `run` вызывается из `main.ts` после `listen`, а не из хука Nest: утилита импорта загружает
 * данные через HTTP API, и до открытия порта ей не к чему подключаться. Пока шаги не
 * завершились, сервер уже отвечает на запросы, но данные в нём неполные.
 */
@Injectable()
export class InitialDataService {
    private readonly logger = new Logger(InitialDataService.name);

    constructor(
        private readonly database: DatabaseService,
        private readonly settings: SettingsService,
        @Inject(ServerPort) private readonly port: number,
        private readonly authentication: AuthenticationService,
        private readonly rightsGuard: RightsGuardPlatform,
        private readonly data: DataService,
    ) {}

    /**
     * Выполняет шаги по порядку зависимостей между ними:
     *
     * ```text
     * пользователи → ┬ физические лица → случайные сотрудники
     *                ├ номенклатура
     *                └ ставка собственной рассрочки
     * ```
     *
     * Пользователи нужны утилите для входа. Две ветки импорта независимы и идут параллельно;
     * сотрудники ждут только физических лиц. Ошибка любого шага прерывает вторую ветку
     * и отклоняет промис.
     */
    run(): Promise<void> {
        const program = createInitialUsers(this.settings.initialUsers, this.rightsGuard.roles.map((role) => role.name), (pin) => this.authentication.pinHash(pin)).pipe(
            Effect.andThen(this.operatorPin()),
            Effect.andThen((pin) => Effect.all([
                this.importCatalog('physical-persons', pin).pipe(Effect.andThen(this.createRandomEmployees(pin))),
                this.importCatalog('nomenclature', pin),
                this.createOwnInstallmentRate(pin),
            ], { concurrency: 'unbounded', discard: true })),
            Effect.provideService(Database, this.database.effect),
        );
        return Effect.runPromise(program);
    }

    /**
     * PIN начального пользователя со всеми ролями: от его имени утилита пишет справочники
     * и внешние связи, а сервер создаёт сотрудников. Пользователь с ограниченными ролями
     * мог бы не иметь нужных прав, поэтому он не выбирается.
     */
    private operatorPin(): Effect.Effect<string, InitialDataError> {
        const operator = this.settings.initialUsers.find((user) => user.roles === undefined);
        return operator === undefined
            ? Effect.fail(new InitialDataError({
                message: 'Для применения первичных данных нужен начальный пользователь со всеми ролями: initialUser без roles в файле настроек или --test-pin без ролей',
            }))
            : Effect.succeed(operator.pin);
    }

    /**
     * Утилита соединяется с сервером по адресу, который он слушает (`importServerAddress`):
     * сервер с адресом в сети магазина в `host` на `127.0.0.1` не отвечает.
     */
    private importCatalog(mapping: string, pin: string): Effect.Effect<void, InitialDataError> {
        return runImportTool(mapping, importServerAddress(this.settings.host, this.port), pin).pipe(
            Effect.tap((summary) => Effect.sync(() => this.logger.log(`Импорт «${mapping}»: ${summary}`))),
            Effect.asVoid,
        );
    }

    /** Создаёт ставку «Собственная» (0 %), если её нет: её получает каждая собственная рассрочка. */
    private createOwnInstallmentRate(pin: string) {
        return Effect.gen(function* (this: InitialDataService) {
            const operations = yield* ownInstallmentRateOperations;
            if (operations.length === 0) return;
            const userGuid = yield* this.authentication.activeUserGuid(pin);
            if (userGuid === undefined) {
                return yield* new InitialDataError({ message: 'Начальный пользователь не найден в базе или отключён: его PIN в настройках не совпадает с сохранённым' });
            }
            yield* Effect.tryPromise({
                try: () => this.data.perform(operations, userGuid),
                catch: (cause) => new InitialDataError({
                    message: `Не удалось создать ставку собственной рассрочки: ${cause instanceof Error ? cause.message : String(cause)}`,
                }),
            });
            this.logger.log('Создана ставка собственной рассрочки');
        }.bind(this));
    }

    /** Записывает сотрудников одним пакетом: при ошибке любой записи не остаётся ни одного. */
    private createRandomEmployees(pin: string) {
        return Effect.gen(function* (this: InitialDataService) {
            // В магазинной базе сотрудники создаются вручную. Настройка выключает только
            // демонстрационный шаг: импорт физических лиц и создание первого администратора остаются.
            if (!this.settings.initialData.createRandomEmployees) return;
            const operations = yield* randomEmployeeOperations(randomEmployeeCount);
            if (operations.length === 0) {
                this.logger.log('Сотрудники уже есть, случайные не создаются');
                return;
            }
            // Пользователь ищется тем же способом, что и при входе: PIN из настроек мог не совпасть с сохранённым.
            const userGuid = yield* this.authentication.activeUserGuid(pin);
            if (userGuid === undefined) {
                return yield* new InitialDataError({ message: 'Начальный пользователь не найден в базе или отключён: его PIN в настройках не совпадает с сохранённым' });
            }
            yield* Effect.tryPromise({
                try: () => this.data.perform(operations, userGuid),
                catch: (cause) => new InitialDataError({
                    message: `Не удалось создать случайных сотрудников: ${cause instanceof Error ? cause.message : String(cause)}`,
                }),
            });
            this.logger.log(`Создано случайных сотрудников: ${operations.length}`);
        }.bind(this));
    }
}
