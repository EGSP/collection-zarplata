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
import type { Effect } from 'effect';


/** Служебные обработчики встроенного справочника, которые сервер связывает с авторизацией. */
export interface UserAdministration {
    readonly roleOptions: Effect.Effect<readonly { name: string; title: string; all: boolean }[]>;
    readonly sessions: (input: { readonly guid: string }) => Effect.Effect<readonly UserSession[], unknown>;
    readonly setPin: (input: { readonly guid: string; readonly pin: string }) => Effect.Effect<null, unknown>;
    readonly revokeSession: (input: { readonly guid: string; readonly sessionGuid: string }) => Effect.Effect<null, unknown>;
}
