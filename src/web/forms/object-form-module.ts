/**
 * Запись реестра собственных форм объектов. Отдельный модуль нужен сгенерированному реестру:
 * он вызывает `objectFormModule` для каждой формы, а модуль выбора форм сам импортирует реестр.
 * В одном модуле импорты замкнулись бы в кольцо.
 */
import type { ComponentType } from 'react';
import { isObjectFormDefinition, type ObjectFormDefinition, type ObjectFormKind } from '../../server/metadata/object-forms';
import type { ListFormProperties, NewFormProperties, RecordFormProperties } from '../sdk';

/** Свойства компонента формы по её виду. */
export interface ObjectFormPropertiesByKind {
    readonly list: ListFormProperties;
    readonly record: RecordFormProperties;
    readonly new: NewFormProperties;
}

/**
 * Вид формы, которую объявляет файл. Если объявления в экспорте нет, вид не выводится, и компонент
 * не проверяется: такую конфигурацию сервер не запустит.
 */
type DeclaredKind<Declaration> = Extract<Declaration[keyof Declaration], ObjectFormDefinition>['kind'];

/** Собственная форма объекта в реестре клиента. */
export interface ObjectFormModule {
    /** Путь файла объявления относительно `src/configuration`. */
    readonly file: string;
    /** Объявление формы из экспорта файла либо `undefined`, если файл его не экспортирует. */
    readonly definition: ObjectFormDefinition | undefined;
    /** Компонент формы; его свойства соответствуют виду формы в объявлении. */
    readonly component: ComponentType<never>;
}

/**
 * Создаёт запись реестра. Компилятор сверяет свойства компонента с видом формы в объявлении:
 * компонент списка, объявленный формой записи, не пройдёт проверку типов.
 */
export function objectFormModule<Declaration extends object>(
    file: string,
    declaration: Declaration,
    component: ComponentType<ObjectFormPropertiesByKind[DeclaredKind<Declaration> & ObjectFormKind]>,
): ObjectFormModule {
    const definition = Object.values(declaration).find(isObjectFormDefinition);
    return { file, definition, component: component as ComponentType<never> };
}

