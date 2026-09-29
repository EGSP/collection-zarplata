import type { FieldKind, ObjectTarget, RecorderValue } from './descriptions.js';

/** Цель ссылки: построитель справочника или документа либо функция, которая его возвращает. */
export type ReferenceTarget = ObjectTarget | (() => ObjectTarget);

/** Внутреннее состояние построителя поля. */
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
}

/** Метка обязательного поля в типе построителя. */
export interface RequiredField {
    readonly '~required': true;
}

/**
 * Неизменяемый построитель поля: каждый метод возвращает новый построитель.
 * `Value` — тип значения поля в записи объекта.
 */
export abstract class FieldBuilder<Value> {
    declare readonly '~value': Value;
    readonly '~state': FieldState;

    constructor(state: FieldState) {
        this['~state'] = state;
    }

    title(title: string): this {
        return this.with({ title });
    }

    required(): this & RequiredField {
        return this.with({ required: true }) as this & RequiredField;
    }

    protected with(patch: Partial<FieldState>): this {
        const constructor = this.constructor as new (state: FieldState) => this;
        return new constructor({ ...this['~state'], ...patch });
    }
}

export class StringFieldBuilder extends FieldBuilder<string> {
    minimumLength(minimumLength: number): this {
        return this.with({ minimumLength });
    }

    maximumLength(maximumLength: number): this {
        return this.with({ maximumLength });
    }
}

export class NumberFieldBuilder extends FieldBuilder<number> {
    minimum(minimum: number): this {
        return this.with({ minimum });
    }

    maximum(maximum: number): this {
        return this.with({ maximum });
    }

    integer(): this {
        return this.with({ integer: true });
    }
}

/** Деньги: целое число копеек. Границы тоже задаются в копейках. */
export class MoneyFieldBuilder extends FieldBuilder<number> {
    minimum(minimum: number): this {
        return this.with({ minimum });
    }

    maximum(maximum: number): this {
        return this.with({ maximum });
    }
}

/** Дата: строка `YYYY-MM-DD`. */
export class DateFieldBuilder extends FieldBuilder<string> {}

/** Дата и время: строка ISO 8601 с часовым поясом. */
export class DateTimeFieldBuilder extends FieldBuilder<string> {}

export class BooleanFieldBuilder extends FieldBuilder<boolean> {}

/** Ссылка на справочник или документ. Значение — `guid` объекта. */
export class ReferenceFieldBuilder extends FieldBuilder<string> {}

/** Идентификатор объекта UUIDv7. Используется только в стандартных полях. */
export class GuidFieldBuilder extends FieldBuilder<string> {}

/** Документ-регистратор движения регистра. Используется только в стандартных полях. */
export class RecorderFieldBuilder extends FieldBuilder<RecorderValue> {}

export type AnyFieldBuilder = FieldBuilder<unknown>;

/** Набор построителей полей по именам. */
export type FieldMap = { readonly [name: string]: AnyFieldBuilder };

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
     * Ссылка на справочник или документ. Цель передаётся построителем,
     * а при циклическом импорте — функцией, которая возвращает построитель.
     */
    reference(target: ReferenceTarget): ReferenceFieldBuilder {
        return new ReferenceFieldBuilder({ ...initialState('reference'), target });
    }
}

export const fieldFactory = new FieldFactory();

/** Построители полей, которых нет в публичной фабрике: они нужны только стандартным полям. */
export const standardFieldFactory = {
    guid: (): GuidFieldBuilder => new GuidFieldBuilder(initialState('guid')),
    recorder: (): RecorderFieldBuilder => new RecorderFieldBuilder(initialState('recorder')),
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type FieldValue<F> = F extends FieldBuilder<infer Value> ? (F extends RequiredField ? Value : Value | null) : never;

/** Тип записи по набору полей: обязательные поля — значение, необязательные — значение или `null`. */
export type FieldsRecord<Fields> = Simplify<{ readonly [Name in keyof Fields]: FieldValue<Fields[Name]> }>;
