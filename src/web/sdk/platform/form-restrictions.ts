/**
 * Ограничения формы записи, которые задают её собственные элементы: недоступность для изменения
 * всей формы, отдельных полей и табличных частей, скрытие действий.
 *
 * Условие ограничения может зависеть от чего угодно, в том числе от данных других объектов,
 * поэтому его вычисляет компонент React на форме, а не настройка в описании объекта. Экран формы
 * ведёт учёт ограничений, элементы объявляют в нём свои требования, а форма применяет их
 * объединение: поле недоступно и действие скрыто, если этого требует хотя бы один элемент.
 * Требования элемента действуют, пока он стоит на форме.
 *
 * Элемент узнаёт условие только после того, как форма с записью появилась на экране. Чтобы запись,
 * которую менять нельзя, не выглядела изменяемой даже на время загрузки, форма недоступна целиком
 * и не показывает действия, пока требования не собраны: до первого сбора и пока хотя бы один
 * элемент сообщил, что условие ему ещё не известно.
 *
 * Ограничения управляют только интерфейсом. Запрет изменения записи обеспечивает политика записи
 * объекта на сервере: действие, скрытое на форме, остаётся доступным через `/api/perform`.
 */
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';

/**
 * Требования одного элемента к форме. `Field` — имена полей и табличных частей, `Action` — имена
 * действий: у ссылки на объект конфигурации их проверяет компилятор.
 */
export interface FormRestrictions<Field extends string = string, Action extends string = string> {
    /**
     * Вся форма недоступна для изменения. Действие «Записать» на такой форме скрыто само,
     * остальные действия элемент скрывает через `hiddenActions`.
     */
    readonly readOnly?: boolean;
    /** Поля и табличные части, недоступные для изменения. Остальные части формы редактируются. */
    readonly readOnlyFields?: ReadonlyArray<Field>;
    /** Действия, стандартные и собственные, которые форма не показывает и не выполняет по сочетанию клавиш. */
    readonly hiddenActions?: ReadonlyArray<Action>;
}

/** Учёт ограничений формы: объединение требований всех элементов, которые на ней стоят. */
export interface FormRestrictionRegistry {
    /**
     * Требования ещё не собраны: элементы не успели их объявить либо условие одного из них
     * ещё не известно. На это время форма недоступна целиком, а все её действия скрыты.
     */
    readonly pending: boolean;
    /** Вся форма недоступна для изменения, в том числе пока требования не собраны. */
    readonly readOnly: boolean;
    /** Недоступно ли для изменения поле или табличная часть на форме, которая сама доступна. */
    readonly isFieldReadOnly: (name: string) => boolean;
    readonly isActionHidden: (name: string) => boolean;
    /**
     * Объявляет требования элемента с ключом `key`; `null` означает, что условие элементу ещё
     * не известно. Возвращает функцию, которая требования снимает. Вызывается в эффекте раскладки:
     * так форма применяет требования до того, как браузер её покажет.
     */
    readonly declare: (key: string, restrictions: FormRestrictions | null) => () => void;
}

/**
 * Создаёт учёт ограничений для экрана с формой. Экран передаёт его поставщику данных формы
 * (`FormDataProvider`), а сам по нему решает, доступна ли форма и какие действия показать.
 */
export function useFormRestrictionRegistry(): FormRestrictionRegistry {
    const [declared, setDeclared] = useState<ReadonlyMap<string, FormRestrictions | null>>(new Map());
    const [collected, setCollected] = useState(false);
    // Эффект экрана выполняется после эффектов элементов, которые стоят внутри него: к этому
    // моменту они уже объявили требования, и оба обновления попадают в одну отрисовку до показа.
    useLayoutEffect(() => setCollected(true), []);

    const declare = useCallback((key: string, restrictions: FormRestrictions | null) => {
        setDeclared((previous) => new Map(previous).set(key, restrictions));
        return () => {
            setDeclared((previous) => {
                const next = new Map(previous);
                next.delete(key);
                return next;
            });
        };
    }, []);

    return useMemo((): FormRestrictionRegistry => {
        const known = [...declared.values()].filter((restrictions) => restrictions !== null);
        const pending = !collected || known.length < declared.size;
        const readOnlyFields = new Set(known.flatMap((restrictions) => restrictions.readOnlyFields ?? []));
        const hiddenActions = new Set(known.flatMap((restrictions) => restrictions.hiddenActions ?? []));
        return {
            pending,
            readOnly: pending || known.some((restrictions) => restrictions.readOnly === true),
            isFieldReadOnly: (name) => readOnlyFields.has(name),
            isActionHidden: (name) => pending || hiddenActions.has(name),
            declare,
        };
    }, [declared, collected, declare]);
}
