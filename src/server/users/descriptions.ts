/** Безопасное представление учётной записи: секреты отсутствуют и в контракте чтения. */
export interface UserAccount {
    readonly guid: string;
    readonly name: string;
    readonly disabledAt: string | null;
    readonly roles: readonly string[];
}

/** Публичные сведения сессии; значения и хеши токенов сюда не входят. */
export interface UserSession {
    readonly guid: string;
    readonly createdAt: string;
    readonly lastConnectedAt: string;
    readonly refreshedAt: string;
}
