/** Контракт чтения журнала без серверных зависимостей, доступный клиентской сборке. */
/**
 * Изменённые поля и табличные части: `{ "поле": { "before": …, "after": … } }`. Табличная часть
 * записывается целиком, списком строк до и после действия: строки не имеют собственного
 * идентификатора, и сопоставить отдельные строки до и после замены нельзя.
 */
export type JournalChanges = Record<string, { readonly before: unknown; readonly after: unknown }>;

/** Объект, над которым выполнено действие. `guid` пуст у собственного действия, которое не относится к одной записи. */
export interface JournalTarget {
    readonly kind: string;
    readonly name: string;
    readonly guid: string | null;
    /** Полный ключ сведений; для объектов с guid отсутствует. */
    readonly key?: Record<string, unknown>;
}

/** Строка журнала в ответе API: колонки таблицы, `changes` уже разобран из JSON. */
export interface JournalEntry {
    readonly guid: string;
    readonly occurredAt: string;
    readonly userGuid: string | null;
    /** Текущее имя автора; null у системного действия или отсутствующего пользователя. */
    readonly userName: string | null;
    readonly traceGuid: string;
    readonly actionGuid: string;
    readonly parentActionGuid: string | null;
    readonly targetKind: string;
    readonly targetName: string;
    readonly targetGuid: string | null;
    /** Измерения записи сведений; для других объектов null. */
    readonly targetKey: Record<string, unknown> | null;
    readonly action: string;
    readonly changes: JournalChanges | null;
}

/** Узел дерева цепочки: действие и вызванные им вложенные действия в порядке выполнения. */
export interface JournalTraceNode extends JournalEntry {
    readonly children: readonly JournalTraceNode[];
}


