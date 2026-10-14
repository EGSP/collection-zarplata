import { useEffect, useState } from 'react';
import { useRecord, useRecordList, type ApiError } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Число сотрудников с согласованным словом: «1 сотрудник», «2 сотрудника», «5 сотрудников». */
export function employeeCount(count: number): string {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return `${count} сотрудников`;
    if (last === 1) return `${count} сотрудник`;
    if (last >= 2 && last <= 4) return `${count} сотрудника`;
    return `${count} сотрудников`;
}

/** Открытая смена: строка списка смен и, когда прочитана, полная запись с составом. */
export interface OpenShiftState {
    readonly guid: string;
    /** Дата и время открытия смены. */
    readonly date: unknown;
    /** Число сотрудников смены; `undefined`, пока полная запись не прочитана. */
    readonly employees: number | undefined;
}

/** Результат чтения текущей смены. */
export interface CurrentShiftState {
    /** Получен ли хотя бы один ответ сервера. До него `shift` равен `null`, но смена может быть открыта. */
    readonly known: boolean;
    /** Ошибка последнего чтения списка смен. */
    readonly error: ApiError | null;
    /** Открытая смена или `null`, если её нет. */
    readonly shift: OpenShiftState | null;
}

/**
 * Читает текущую смену: блоку «Текущая смена» и рабочему месту продавца она нужна одинаково.
 *
 * Открытой считается смена без даты закрытия. Хук находит её чтением списка смен с постоянным
 * отбором, а не отдельным действием сервера: политика смены допускает не больше одной такой записи.
 * Состав лежит в табличной части, а строка списка её не содержит, поэтому для числа сотрудников
 * хук дочитывает запись смены.
 *
 * Перечитывать данные не нужно: открытие и закрытие смены помечают сохранённые ответы сервера
 * устаревшими, и чтения хука повторяются на всех вкладках, где он используется.
 */
export function useCurrentShift(): CurrentShiftState {
    const shifts = Objects.document.shift;
    const list = useRecordList(shifts, { permanentFilter: [{ field: 'closedAt', operator: 'equals', value: null }], pageSize: 1 });
    const current = list.records[0] ?? null;
    const { record } = useRecord(shifts, current?.guid ?? null);

    // До первого ответа сервера список пуст так же, как при отсутствии открытой смены.
    // Без этого признака экран на время загрузки сообщал бы, что смена не открыта, и разрешал её открыть.
    const [known, setKnown] = useState(false);
    useEffect(() => {
        if (!list.loading && list.error === null) setKnown(true);
    }, [list.loading, list.error]);

    return {
        known,
        error: list.error,
        shift: current === null ? null : { guid: current.guid, date: current.date, employees: record?.employees.length },
    };
}
