/**
 * Собственные элементы формы на клиенте: блоки конфигурации, которые стоят на стандартной форме.
 *
 * Компонент элемента попадает в клиент при сборке, а не через `/api/metadata`: реестр
 * `form-elements.generated.ts` создаёт генератор по файлам `src/configuration`. Сервер в описании
 * формы называет только имя элемента и его место, а компонент по имени находится здесь.
 *
 * Реестр подключает стандартная форма, а не web SDK: компоненты элементов сами импортируют SDK,
 * и импорт реестра из SDK замкнул бы модули в кольцо.
 */
import { formElements } from '../../configuration/form-elements.generated';
import { isFormComponentDefinition, type FormComponentDefinition } from '../../server/metadata/form-elements';
import type { FieldInputMark, FormElementComponent } from '../sdk';

/** Элемент формы в реестре клиента. */
export interface FormElementModule {
    /** Путь файла объявления относительно `src/configuration`. */
    readonly file: string;
    /** Экспорт файла объявления: из него берётся имя элемента. */
    readonly declaration: object;
    /** Компонент элемента: экспорт по умолчанию файла компонента. */
    readonly component: FormElementComponent;
}

/**
 * Виды мест подключения, которые объявляет файл. Если объявления в экспорте нет, вид не выводится,
 * и компонент не проверяется: такую конфигурацию сервер не запустит.
 */
type DeclaredPlacement<Declaration> = Extract<Declaration[keyof Declaration], FormComponentDefinition>['~placement'];

/**
 * Компонент, который подходит местам подключения. Элемент на месте поля ввода обязан поддержать
 * обе компоновки поля, поэтому собирается функцией `fieldInput` SDK; остальным подходит любой компонент.
 */
type ComponentFor<Placement> = [Extract<Placement, 'field'>] extends [never] ? FormElementComponent : FormElementComponent & FieldInputMark;

/**
 * Создаёт запись реестра. Компилятор сверяет компонент с местами подключения в объявлении:
 * обычный компонент, объявленный на месте поля ввода, не пройдёт проверку типов, потому что
 * не поддерживает fluid-компоновку.
 */
export function formElementModule<Declaration extends object>(file: string, declaration: Declaration, component: ComponentFor<DeclaredPlacement<Declaration>>): FormElementModule {
    return { file, declaration, component: component as FormElementComponent };
}

/**
 * Компоненты элементов по именам. Соглашение об экспорте объявления проверяет сервер при запуске,
 * поэтому файл без билдера элемента здесь пропускается: сервер с такой конфигурацией не запустится.
 */
const components: ReadonlyMap<string, FormElementComponent> = new Map(
    formElements.flatMap((element) => {
        const builder = Object.values(element.declaration).find(isFormComponentDefinition);
        return builder === undefined ? [] : [[builder.name, element.component] as const];
    }),
);

/** Компонент элемента формы по имени из описания формы. */
export function formElementComponent(name: string): FormElementComponent | undefined {
    return components.get(name);
}
