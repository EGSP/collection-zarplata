import { CloseOutlined, FilterOutlined } from '@ant-design/icons';
import type { CrudFilter } from '@refinedev/core';
import { Button, Flex, Input, Select } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FilterOperator, ListFilter } from '../../server/ui/descriptions';
import { useDebounced } from '../common/debounced';
import { crudOperators, filterOperator } from '../data-provider/data-provider';
import { FieldInput, hasInput } from '../widgets/registry';

/** Названия способов сравнения для пользователя. */
const operatorTitles: { readonly [Operator in FilterOperator]: string } = {
    equals: 'равно',
    notEquals: 'не равно',
    greater: 'больше',
    greaterOrEqual: 'больше или равно',
    less: 'меньше',
    lessOrEqual: 'меньше или равно',
    contains: 'содержит',
};

/** Задержка применения отбора после изменения условий, в миллисекундах: запрос не уходит на каждое нажатие клавиши. */
const applyDelay = 400;

/** Условие отбора, которое составляет пользователь. Пока значение не введено, условие не применяется. */
interface Condition {
    /** Ключ строки условия: порядковый номер, который не меняется при удалении соседних условий. */
    readonly key: number;
    readonly field: string;
    readonly operator: FilterOperator;
    readonly value: unknown;
}

/**
 * Отбор Refine по условиям пользователя. Условие без значения пропускается. Из условий с одним
 * полем и способом сравнения остаётся первое: Refine различает условия по этой паре, и второе
 * он отбросил бы сам.
 */
function appliedFilters(conditions: ReadonlyArray<Condition>): Array<CrudFilter> {
    const seen = new Set<string>();
    return conditions.flatMap((condition) => {
        const pair = `${condition.field}/${condition.operator}`;
        if (condition.value === null || condition.value === undefined || seen.has(pair)) return [];
        seen.add(pair);
        return [{ field: condition.field, operator: crudOperators[condition.operator], value: condition.value }];
    });
}

/** Условия пользователя по отбору Refine, например по отбору из адреса страницы. Условия, которых описание списка не предлагает, пропускаются. */
function conditionsOf(applied: ReadonlyArray<CrudFilter>, available: ReadonlyArray<ListFilter>): Array<Condition> {
    return applied.flatMap((filter, index) => {
        if (!('field' in filter)) return [];
        const operator = filterOperator(filter.operator);
        const description = available.find((candidate) => candidate.field === filter.field);
        if (operator === undefined || description === undefined || !description.operators.includes(operator)) return [];
        return [{ key: index, field: filter.field, operator, value: filter.value as unknown }];
    });
}

/**
 * Содержимое отбора одной строкой, чтобы сравнивать отборы. Порядок свойств условия в строку
 * не входит: у условия, разобранного из адреса страницы, он может быть другим.
 */
function signature(filters: ReadonlyArray<CrudFilter>): string {
    return JSON.stringify(filters.map((filter) => ('field' in filter ? [filter.field, filter.operator, filter.value] : filter)));
}

/** Значение нового условия. Флажок не бывает незаполненным, поэтому условие по логическому полю сразу означает «да». */
function initialValue(filter: ListFilter): unknown {
    return filter.kind === 'boolean' ? true : null;
}

interface ListFiltersProperties {
    /** Отборы, которые предлагает описание списка. */
    readonly filters: ReadonlyArray<ListFilter>;
    /** Действующий отбор списка. */
    readonly applied: ReadonlyArray<CrudFilter>;
    /** Вызывается, когда условия пользователя дают другой отбор. */
    readonly onApply: (filters: Array<CrudFilter>) => void;
}

/**
 * Отбор списка: пользователь составляет его из условий «поле, способ сравнения, значение».
 * Условия соединяются через «и». Для `contains` пользователь вводит подстроку отображаемого
 * значения свободным текстом. Остальные способы используют поле ввода и формат значения сервера.
 *
 * Условия хранятся здесь, а не берутся из действующего отбора: у пользователя может быть
 * начатое условие без значения, которого в отборе ещё нет.
 */
export function ListFilters({ filters, applied, onApply }: ListFiltersProperties) {
    // Регистратор пользователь не вводит, поля ввода для него нет, поэтому отбор по нему не предлагается.
    const available = useMemo(() => filters.filter(hasInput), [filters]);
    const [conditions, setConditions] = useState(() => conditionsOf(applied, available));
    const nextKey = useRef(applied.length);

    // Отбор, который список получил от этих условий. Если действующий отбор от него отличается,
    // его изменил не пользователь здесь: например, переход по меню сбросил состояние списка.
    const sent = useRef(signature(applied));
    const appliedSignature = signature(applied);
    useEffect(() => {
        if (appliedSignature === sent.current) return;
        sent.current = appliedSignature;
        nextKey.current = applied.length;
        setConditions(conditionsOf(applied, available));
        // Зависимость только от содержимого отбора: массив `applied` пересоздаётся при каждой отрисовке.
    }, [appliedSignature]);

    const debounced = useDebounced(conditions, applyDelay);
    useEffect(() => {
        const next = appliedFilters(debounced);
        const nextSignature = signature(next);
        if (nextSignature === sent.current) return;
        sent.current = nextSignature;
        onApply(next);
        // Применяется только изменение условий: смена обработчика отбор не меняет.
    }, [debounced]);

    const change = (key: number, patch: Partial<Condition>) =>
        setConditions((current) => current.map((condition) => (condition.key === key ? { ...condition, ...patch } : condition)));

    const add = () => {
        const first = available[0];
        const operator = first?.operators[0];
        if (first === undefined || operator === undefined) return;
        setConditions((current) => [...current, { key: nextKey.current++, field: first.field, operator, value: initialValue(first) }]);
    };

    if (available.length === 0) return null;
    return (
        <Flex vertical gap="small" align="flex-start">
            {conditions.map((condition) => {
                const description = available.find((candidate) => candidate.field === condition.field);
                if (description === undefined) return null;
                return (
                    <Flex key={condition.key} gap="small" align="center">
                        <Select
                            style={{ width: 220 }}
                            value={condition.field}
                            options={available.map((filter) => ({ value: filter.field, label: filter.title }))}
                            onChange={(field: string) => {
                                const selected = available.find((candidate) => candidate.field === field);
                                const operator = selected?.operators[0];
                                // У другого поля свои способы сравнения и свой вид значения, поэтому прежние не сохраняются.
                                if (selected !== undefined && operator !== undefined) change(condition.key, { field, operator, value: initialValue(selected) });
                            }}
                        />
                        <Select
                            style={{ width: 180 }}
                            value={condition.operator}
                            options={description.operators.map((operator) => ({ value: operator, label: operatorTitles[operator] }))}
                            onChange={(operator: FilterOperator) => {
                                // При переходе между подстрокой и точным значением меняется тип ввода:
                                // прежние копейки или часть даты нельзя отправлять как новое условие.
                                const changesInput = (condition.operator === 'contains') !== (operator === 'contains');
                                change(condition.key, { operator, ...(changesInput ? { value: initialValue(description) } : {}) });
                            }}
                        />
                        <div style={{ width: 280 }}>
                            {condition.operator === 'contains' ? (
                                <Input
                                    aria-label="Подстрока для поиска"
                                    value={typeof condition.value === 'string' ? condition.value : ''}
                                    onChange={(event) => change(condition.key, { value: event.target.value === '' ? null : event.target.value })}
                                />
                            ) : (
                                <FieldInput field={description} value={condition.value} onChange={(value) => change(condition.key, { value })} />
                            )}
                        </div>
                        <Button
                            type="text"
                            icon={<CloseOutlined />}
                            aria-label="Убрать условие"
                            onClick={() => setConditions((current) => current.filter((candidate) => candidate.key !== condition.key))}
                        />
                    </Flex>
                );
            })}
            <Button icon={<FilterOutlined />} onClick={add}>
                Добавить условие
            </Button>
        </Flex>
    );
}
