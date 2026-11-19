import type { AccessLevel, AccessTarget } from './access-schema.js';

/** Роль или учётная запись, для которой можно открыть настройки в дереве. */
export interface AccessSubject {
    readonly subjectKind: 'role' | 'user';
    readonly subject: string;
    readonly title: string;
}

/** Адрес настройки в схеме, общий для отображения, расчёта и сохранения. */
export interface AccessAddress extends AccessTarget {
    readonly path: string;
}

/** Узел дерева. Пункты меню группируют объекты и не имеют адреса настройки. */
export interface AccessNode {
    readonly key: string;
    readonly title: string;
    readonly count: number;
    readonly address: AccessAddress | null;
    readonly children: readonly AccessNode[];
}

/** Полное дерево и варианты верхнего пикера. */
export interface AccessTree {
    readonly nodes: readonly AccessNode[];
    readonly subjects: readonly AccessSubject[];
}

/** Итоговый уровень и источник, рассчитанные сервером. */
export interface AccessEffective {
    readonly level: Exclude<AccessLevel, 'inherit'>;
    /** Путь настройки. Значение 'default' означает, что разрешение не задано. */
    readonly sourcePath: string;
    readonly source: string;
}

/** Текущее право на узел или охват дочерних настроек у группы меню. */
export interface AccessOverviewEntry extends AccessSubject {
    readonly access: AccessEffective | { readonly allowed: number; readonly total: number };
}

/** Обзор одного узла для всех активных пользователей и объявленных ролей. */
export interface AccessExplanation {
    readonly key: string;
    readonly subjects: readonly AccessOverviewEntry[];
}

/** Отдельная настройка роли или пользователя с доступными вариантами изменения. */
export interface AccessNodeSetting extends AccessAddress {
    readonly title: string;
    readonly call: boolean;
    readonly levels: readonly AccessLevel[];
    readonly selected: AccessLevel;
    /** Действующий уровень отличается от уровня без правок этого назначения в базе. */
    readonly differsFromBaseline: boolean;
    readonly effective: AccessEffective;
}

/** Ответ редактора. Сервер отдельно сообщает, разрешено ли сохранять выбранное назначение. */
export interface AccessSettings {
    readonly subjects: readonly AccessSubject[];
    readonly subjectKind: AccessSubject['subjectKind'];
    readonly subject: string;
    readonly readOnly: boolean;
    readonly editable: boolean;
    readonly nodes: readonly AccessNodeSetting[];
}
