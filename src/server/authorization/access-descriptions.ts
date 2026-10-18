/** Узел полного дерева прав. Счётчик содержит уникальных активных пользователей поддерева. */
export interface AccessNode {
    readonly key: string;
    readonly title: string;
    readonly count: number;
    /** Ключ конечного права; у группы или объекта null. */
    readonly right: string | null;
    readonly children: readonly AccessNode[];
}

/** Основание доступа: имя и название роли, с явным признаком полного доступа. */
export interface AccessRole {
    readonly name: string;
    readonly title: string;
    readonly all: boolean;
}

/** Роль конфигурации и разрешаемые ею права выбранного узла, независимо от назначений. */
export interface AccessRoleEntry extends AccessRole {
    readonly rights: readonly { readonly key: string; readonly title: string }[];
}

/** Права одного активного пользователя внутри выбранного узла со всеми ролями-основаниями. */
export interface AccessUser {
    readonly guid: string;
    readonly name: string;
    readonly rights: readonly {
        readonly key: string;
        /** Путь включает объект: одинаковые «Чтение» в объяснении группы различимы. */
        readonly title: string;
        readonly roles: readonly AccessRole[];
    }[];
}

/** Объяснение выбранного узла. У пользователя без прав в поддереве строки нет. */
export interface AccessExplanation {
    readonly node: Omit<AccessNode, 'children'>;
    readonly users: readonly AccessUser[];
    readonly roles: readonly AccessRoleEntry[];
}
