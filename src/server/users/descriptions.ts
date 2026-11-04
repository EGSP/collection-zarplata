/** Служебный объект ИБ: имеет список и формы, но хранится в таблицах авторизации. */
export const platformUsers = { kind: 'platform', name: 'users' } as const;

/** Безопасное представление учётной записи: секреты отсутствуют и в контракте чтения. */
export interface UserAccount {
    readonly guid: string;
    readonly name: string;
    readonly disabledAt: string | null;
    readonly roles: readonly string[];
}

/** Список и варианты назначения из текущей конфигурации. Удалённые роли остаются видны по имени. */
export interface UserDirectory {
    readonly items: readonly UserAccount[];
    readonly roles: readonly { readonly name: string; readonly title: string; readonly all: boolean }[];
    readonly canWrite: boolean;
}

/** Публичные сведения сессии; значения и хеши токенов сюда не входят. */
export interface UserSession {
    readonly guid: string;
    readonly createdAt: string;
    readonly lastConnectedAt: string;
    readonly refreshedAt: string;
}
