/**
 * Билдеры полей и фабрика, через которую конфигурация их создаёт: `(field) => field.string()`.
 *
 * Тип значения поля хранится в параметре `Value`, а обязательность — меткой `RequiredField`,
 * которую добавляет `required()`. Из этих двух признаков `FieldsRecord` выводит тип записи.
 * Метка добавляется пересечением типов, а не отдельным параметром, чтобы `required()` можно было
 * объявить один раз в базовом классе и сохранить тип подкласса со всеми его методами.
 */
import type { Formula } from '../../common/formulas.js';
import type { CompositeReferenceValue, CompositeType, FieldKind, ObjectTarget, RecorderValue, ObjectReferenceValue } from './descriptions.js';

/**
 * Цель ссылки: билдер справочника или документа либо функция, которая его возвращает.
 * Функция нужна при циклическом импорте, когда экспорт другого файла ещё не инициализирован.
 * От цели требуются только вид и имя, поэтому тип поля ссылки не зависит от типа цели
 * и два объекта могут ссылаться друг на друга без циклического вывода типов.
 */
export type ReferenceTarget = ObjectTarget | (() => ObjectTarget);

/** Всё, что накопила цепочка вызовов билдера поля. Свойства, не относящиеся к виду поля, остаются `null`. */
export interface FieldState {
    readonly kind: FieldKind;
    readonly title: string | null;
    readonly required: boolean;
    readonly minimumLength: number | null;
    readonly maximumLength: number | null;
    readonly minimum: number | null;
    readonly maximum: number | null;
    readonly integer: boolean;
    readonly target: ReferenceTarget | null;
    /** Допустимые строковые значения; null означает свободный ввод. */
    readonly choices: ReadonlyArray<string> | null;
    /** Значение строки в новой записи или новой строке формы; null оставляет поле пустым. */
    readonly initial: string | null;
    readonly computed: Formula | null;
    readonly suggestions: { readonly target: ReferenceTarget; readonly field: string } | null;
    readonly expandedTablePart: string | null;
    /** Варианты составного поля в порядке объявления; у остальных видов `null`. */
    readonly variants: ReadonlyArray<AnyFieldBuilder> | null;
}

/** Метка обязательного поля в типе билдера. Существует только на уровне типов. */
export interface RequiredField {
    readonly '~required': true;
}

/**
 * Неизменяемый билдер поля: каждый метод возвращает новый билдер.
 * `Value` — тип значения поля в записи объекта.
 */
export abstract class FieldBuilder<Value> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~value': Value;
    readonly '~state': FieldState;

    constructor(state: FieldState) {
        this['~state'] = state;
    }

    /** Подпись поля в интерфейсе. Если она не задана, используется имя поля. */
    title(title: string): this {
        return this.with({ title });
    }

    /** Поле должно быть заполнено: в типе записи оно теряет `null`, а схема проверки требует значение. */
    required(): this & RequiredField {
        return this.with({ required: true }) as this & RequiredField;
    }

    /** Создаёт билдер того же подкласса, чтобы после вызова остались методы конкретного вида поля. */
    protected with(patch: Partial<FieldState>): this {
        const constructor = this.constructor as new (state: FieldState) => this;
        return new constructor({ ...this['~state'], ...patch });
    }
}

/** Строка. Длина считается в символах UTF-16, как `String.length`. */
export class StringFieldBuilder extends FieldBuilder<string> {
    /** Только для вывода типов: по виду составное поле выбирает тип значения варианта. */
    declare readonly '~kind': 'string';
    /** Ограничивает ввод заданными значениями и включает выбор из списка в форме. */
    choices(values: ReadonlyArray<string>): this {
        return this.with({ choices: Object.freeze([...values]) });
    }

    /**
     * Значение, которым форма заполняет поле в новой записи и в новой строке табличной части.
     * Действует только на форму: запись через единый эндпоинт без значения поле не заполняет.
     */
    initial(value: string): this {
        return this.with({ initial: value });
    }

    minimumLength(minimumLength: number): this {
        return this.with({ minimumLength });
    }

    maximumLength(maximumLength: number): this {
        return this.with({ maximumLength });
    }
}

/** Число. Для сумм денег используется `MoneyFieldBuilder`: дробные рубли дают ошибки округления. */
export class NumberFieldBuilder extends FieldBuilder<number> {
    declare readonly '~kind': 'number';
    /** Значение вычисляет платформа; клиентское значение при записи игнорируется. */
    computed(expression: Formula): this { return this.with({ computed: expression }); }
    /** Выбор подставляет число, которое пользователь может затем изменить. */
    suggestions(target: ReferenceTarget, field: string): this { return this.with({ suggestions: { target, field } }); }
    minimum(minimum: number): this {
        return this.with({ minimum });
    }

    maximum(maximum: number): this {
        return this.with({ maximum });
    }

    /** Разрешить только целые числа. */
    integer(): this {
        return this.with({ integer: true });
    }
}

/** Деньги: целое число копеек. Границы тоже задаются в копейках. */
export class MoneyFieldBuilder extends FieldBuilder<number> {
    declare readonly '~kind': 'money';
    /** Формула возвращает целое число копеек, например через formula.round(). */
    computed(expression: Formula): this { return this.with({ computed: expression }); }
    /** Источник подсказок сумм в копейках. */
    suggestions(target: ReferenceTarget, field: string): this { return this.with({ suggestions: { target, field } }); }
    minimum(minimum: number): this {
        return this.with({ minimum });
    }

    maximum(maximum: number): this {
        return this.with({ maximum });
    }
}

/** Дата: строка `YYYY-MM-DD`. */
export class DateFieldBuilder extends FieldBuilder<string> {
    declare readonly '~kind': 'date';
}

/** Дата и время: строка ISO 8601 с часовым поясом. */
export class DateTimeFieldBuilder extends FieldBuilder<string> {
    declare readonly '~kind': 'dateTime';
}

/** Логическое значение. */
export class BooleanFieldBuilder extends FieldBuilder<boolean> {
    declare readonly '~kind': 'boolean';
}

/** Ссылка на справочник или документ. Значение — `guid` объекта. */
export class ReferenceFieldBuilder extends FieldBuilder<string> {
    declare readonly '~kind': 'reference';
    /** Раскрытие строки формы показывает указанную часть записи по ссылке. */
    expandTablePart(name: string): this { return this.with({ expandedTablePart: name }); }
}

/** Ссылка произвольного вида: значение содержит тип, имя объекта и guid записи. */
export class ObjectReferenceFieldBuilder extends FieldBuilder<ObjectReferenceValue> {}

/**
 * Билдер, допустимый вариантом составного поля: простой вид платформы либо ссылка с заданной целью.
 * Классы билдеров без собственных методов структурно одинаковы, поэтому их различает метка `~kind`:
 * без неё вариантом прошёл бы, например, билдер стандартного поля `guid`.
 */
export type CompositeVariantBuilder =
    | StringFieldBuilder | NumberFieldBuilder | MoneyFieldBuilder | DateFieldBuilder
    | DateTimeFieldBuilder | BooleanFieldBuilder | ReferenceFieldBuilder;

/**
 * Значение варианта в записи. Простой вариант хранит тип и значение, ссылочный хранит тип и полную
 * ссылку: целей у поля может быть несколько, и по одному `guid` запись не найти.
 */
type CompositeVariantValue<Variant> =
    Variant extends { readonly '~kind': 'reference' } ? CompositeReferenceValue
    : Variant extends { readonly '~kind': infer Type extends Exclude<CompositeType, 'reference'>; readonly '~value': infer Value } ? { readonly type: Type; readonly value: Value }
    : never;

/**
 * Составное поле: значение одного из объявленных вариантов. `Value` является объединением значений
 * вариантов, поэтому `RecordOf` требует различать их по свойству `type`. Ограничения задаются
 * вариантам, а подпись и обязательность самому полю.
 */
export class CompositeFieldBuilder<Value> extends FieldBuilder<Value> {
    declare readonly '~kind': 'composite';
}

/** Идентификатор объекта UUIDv7. Используется только в стандартных полях. */
export class GuidFieldBuilder extends FieldBuilder<string> {}

/** Документ-регистратор движения регистра. Используется только в стандартных полях. */
export class RecorderFieldBuilder extends FieldBuilder<RecorderValue> {}

/** Билдер поля любого вида: `Value` у свойства `~value` только читается, поэтому любой билдер совместим с `unknown`. */
export type AnyFieldBuilder = FieldBuilder<unknown>;

/** Набор билдеров полей по именам. */
export type FieldMap = { readonly [name: string]: AnyFieldBuilder };

/** Начальное состояние поля. Деньги сразу целые: копейки не делятся. */
function initialState(kind: FieldKind): FieldState {
    return {
        kind,
        title: null,
        required: false,
        minimumLength: null,
        maximumLength: null,
        minimum: null,
        maximum: null,
        integer: kind === 'money',
        target: null,
        choices: null,
        initial: null,
        computed: null,
        suggestions: null,
        expandedTablePart: null,
        variants: null,
    };
}

/** Фабрика полей, которую получает функция описания поля: `(field) => field.string()`. */
export class FieldFactory {
    string(): StringFieldBuilder {
        return new StringFieldBuilder(initialState('string'));
    }

    number(): NumberFieldBuilder {
        return new NumberFieldBuilder(initialState('number'));
    }

    /** Деньги: целое число копеек. */
    money(): MoneyFieldBuilder {
        return new MoneyFieldBuilder(initialState('money'));
    }

    date(): DateFieldBuilder {
        return new DateFieldBuilder(initialState('date'));
    }

    dateTime(): DateTimeFieldBuilder {
        return new DateTimeFieldBuilder(initialState('dateTime'));
    }

    boolean(): BooleanFieldBuilder {
        return new BooleanFieldBuilder(initialState('boolean'));
    }

    /**
     * Ссылка на справочник или документ. Цель передаётся билдером,
     * а при циклическом импорте — функцией, которая возвращает билдер.
     * Без цели поле принимает полную ссылку с видом объекта, именем и guid.
     */
    reference(): ObjectReferenceFieldBuilder;
    reference(target: ReferenceTarget): ReferenceFieldBuilder;
    reference(target?: ReferenceTarget): ReferenceFieldBuilder | ObjectReferenceFieldBuilder {
        return target === undefined
            ? new ObjectReferenceFieldBuilder(initialState('objectReference'))
            : new ReferenceFieldBuilder({ ...initialState('reference'), target });
    }

    /**
     * Составное поле: значение одного из перечисленных вариантов. Вариантом служит простой вид
     * платформы или ссылка на конкретный справочник либо документ со своими ограничениями:
     * `field.composite([field.string().maximumLength(200), field.reference(Receivers)])`.
     * Нужно не меньше двух вариантов; простой вид и цель ссылки не повторяются, иначе по значению
     * нельзя было бы определить вариант. Это проверяет `commit()`.
     */
    composite<const Variants extends readonly [CompositeVariantBuilder, CompositeVariantBuilder, ...Array<CompositeVariantBuilder>]>(
        variants: Variants,
    ): CompositeFieldBuilder<CompositeVariantValue<Variants[number]>> {
        return new CompositeFieldBuilder({ ...initialState('composite'), variants: Object.freeze([...variants]) });
    }
}

/** Единственный экземпляр фабрики: состояния у неё нет, поэтому новый экземпляр на каждое поле не нужен. */
export const fieldFactory = new FieldFactory();

/**
 * Билдеры полей, которых нет в публичной фабрике: `guid` и регистратор заполняет платформа,
 * и конфигурации не нужно объявлять такие поля самой.
 */
export const standardFieldFactory = {
    guid: (): GuidFieldBuilder => new GuidFieldBuilder(initialState('guid')),
    recorder: (): RecorderFieldBuilder => new RecorderFieldBuilder(initialState('recorder')),
};

/** Раскрывает пересечение типов в один объект, чтобы подсказка редактора показывала список полей. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Тип значения поля в записи: обязательное — значение, необязательное — значение или `null`. */
type FieldValue<F> = F extends FieldBuilder<infer Value> ? (F extends RequiredField ? Value : Value | null) : never;

/** Тип записи по набору полей. */
export type FieldsRecord<Fields> = Simplify<{ readonly [Name in keyof Fields]: FieldValue<Fields[Name]> }>;
