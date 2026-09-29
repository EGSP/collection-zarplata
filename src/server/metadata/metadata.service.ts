import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Effect } from 'effect';
import { configurationModules } from '../../configuration/configuration.generated.js';
import type { ObjectDescription, ObjectKind } from './descriptions.js';
import { loadConfiguration } from './registry.js';

/**
 * Сервис метаданных — единственный источник описаний объектов конфигурации для платформы.
 *
 * Описания собираются один раз при запуске из сгенерированного реестра и дальше не меняются:
 * конфигурация входит в сборку, и изменить её без перезапуска нельзя. Сборка выполняется
 * в `onModuleInit`, поэтому ошибка в описании любого объекта останавливает запуск приложения
 * до того, как сервер начнёт принимать запросы. Сообщение ошибки перечисляет все проблемы
 * с указанием объекта и места в описании.
 */
@Injectable()
export class MetadataService implements OnModuleInit {
    private readonly logger = new Logger(MetadataService.name);
    private descriptions: ReadonlyArray<ObjectDescription> | undefined;

    onModuleInit(): void {
        // Сборка синхронна: функции целей ссылок и проверки не обращаются к внешним ресурсам.
        this.descriptions = Effect.runSync(loadConfiguration(configurationModules));
        this.logger.log(`Метаданные собраны: объектов ${this.descriptions.length}`);
    }

    /** Описания всех объектов конфигурации в порядке файлов реестра. */
    get objects(): ReadonlyArray<ObjectDescription> {
        if (this.descriptions === undefined) throw new Error('Метаданные ещё не собраны');
        return this.descriptions;
    }

    /** Описание объекта по виду и имени или `undefined`, если такого объекта нет в конфигурации. */
    find(kind: ObjectKind, name: string): ObjectDescription | undefined {
        return this.objects.find((object) => object.kind === kind && object.name === name);
    }
}
