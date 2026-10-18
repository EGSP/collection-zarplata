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
