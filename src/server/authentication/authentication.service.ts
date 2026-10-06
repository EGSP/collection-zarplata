import { Injectable, type OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { jwtVerify, SignJWT } from 'jose';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { assignUserRoles } from '../authorization/user-roles.js';
import { Database } from '../database/database.effect.js';
import { DatabaseService } from '../database/database.service.js';
import { insert, select, update } from '../database/sql.builder.js';
import { SettingsService } from '../settings/settings.service.js';

const accessLifetimeSeconds = 15 * 60;
const refreshLifetimeSeconds = 7 * 24 * 60 * 60;

/** Пара непрозрачных токенов: краткоживущий подписанный access и одноразовый refresh. */
export interface TokenPair {
    readonly access: string;
    readonly refresh: string;
}

type UserRow = Record<string, unknown> & { guid: string; disabledAt: string | null };
type TokenRow = Record<string, unknown> & { userGuid: string; expiresAt: string; revokedAt: string | null };

/**
 * Хранит только HMAC PIN и SHA-256 refresh-токена. Ротация и отзыв выполняются в
 * транзакции, поэтому два одновременных обновления не могут использовать один токен.
 */
@Injectable()
export class AuthenticationService implements OnApplicationBootstrap {
    private readonly signingKey: Uint8Array;

    constructor(
        private readonly database: DatabaseService,
        private readonly settings: SettingsService,
        private readonly rightsGuard: RightsGuardPlatform,
    ) {
        this.signingKey = createHmac('sha256', settings.pinHmacSecret).update('access-token').digest();
    }

    /**
     * Создаёт указанных в настройках пользователей только в пустой таблице и назначает им роли.
     * Пользователь без списка ролей получает все роли конфигурации: первый пользователь должен
     * иметь доступ ко всему, иначе назначить права было бы некому. Роль, которой нет
     * в конфигурации, останавливает запуск: пользователь с ней остался бы без прав.
     */
    async onApplicationBootstrap(): Promise<void> {
        const initial = this.settings.initialUsers;
        if (initial.length === 0) return;
        const known = this.rightsGuard.roles.map((role) => role.name);
        for (const user of initial) {
            const unknown = (user.roles ?? []).filter((role) => !known.includes(role));
            if (unknown.length > 0) {
                throw new Error(`Пользователю «${user.name}» назначены роли, которых нет в конфигурации: ${unknown.join(', ')}. Описанные роли: ${known.join(', ')}`);
            }
        }
        const database = this.database.effect;
        await Effect.runPromise(database.transaction(Effect.gen(function* (this: AuthenticationService) {
            const row = yield* database.get<{ total: number }>({ sql: 'SELECT COUNT(*) AS total FROM platform_users', parameters: [] });
            if ((row?.total ?? 0) !== 0) return;
            for (const user of initial) {
                const guid = randomUUID();
                yield* database.run(insert('platform_users', {
                    guid, name: user.name.trim(), pinHash: this.pinHash(user.pin), disabledAt: null,
                }));
                yield* assignUserRoles(guid, user.roles ?? known);
            }
        }.bind(this)).pipe(Effect.provideService(Database, database))));
    }

    private pinHash(pin: string): string {
        return createHmac('sha256', this.settings.pinHmacSecret).update(pin).digest('hex');
    }

    private tokenHash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    /** Находит активного пользователя по PIN и выдаёт пару; неверный PIN даёт 401. */
    async login(pin: string): Promise<TokenPair> {
        const user = await Effect.runPromise(this.database.effect.get<UserRow>(select('platform_users', {
            columns: ['guid', 'disabledAt'], where: [{ column: 'pinHash', operator: '=', value: this.pinHash(pin) }],
        })));
        if (user === undefined || user.disabledAt !== null) throw new UnauthorizedException('Неверный PIN');
        return this.issue(user.guid);
    }

    private async issue(userGuid: string): Promise<TokenPair> {
        const refresh = randomBytes(32).toString('base64url');
        const access = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
            .setSubject(userGuid).setJti(this.tokenHash(refresh)).setIssuedAt().setExpirationTime(`${accessLifetimeSeconds}s`).sign(this.signingKey);
        await Effect.runPromise(this.database.effect.run(insert('platform_tokens', {
            guid: this.tokenHash(refresh), userGuid,
            expiresAt: new Date(Date.now() + refreshLifetimeSeconds * 1000).toISOString(), revokedAt: null,
        })));
        return { access, refresh };
    }

    /** Подтверждает подпись и срок access-токена, затем проверяет, что пользователь активен. */
    async authenticate(access: string | undefined): Promise<string> {
        if (access === undefined) throw new UnauthorizedException('Требуется вход');
        let guid: string | undefined;
        let sessionHash: string | undefined;
        try {
            const result = await jwtVerify(access, this.signingKey, { algorithms: ['HS256'] });
            guid = result.payload.sub;
            sessionHash = result.payload.jti;
        } catch {
            throw new UnauthorizedException('Требуется повторный вход');
        }
        if (guid === undefined || sessionHash === undefined) throw new UnauthorizedException('Требуется повторный вход');
        const user = await Effect.runPromise(this.database.effect.get<UserRow>(select('platform_users', {
            columns: ['guid', 'disabledAt'], where: [{ column: 'guid', operator: '=', value: guid }],
        })));
        if (user === undefined || user.disabledAt !== null) throw new UnauthorizedException('Требуется повторный вход');
        const session = await Effect.runPromise(this.database.effect.get<TokenRow>(select('platform_tokens', {
            columns: ['userGuid', 'expiresAt', 'revokedAt'], where: [{ column: 'guid', operator: '=', value: sessionHash }],
        })));
        if (session === undefined || session.userGuid !== guid || session.revokedAt !== null || session.expiresAt <= new Date().toISOString()) {
            throw new UnauthorizedException('Требуется повторный вход');
        }
        return guid;
    }

    /** Однократно расходует refresh-токен и выдаёт новую пару в той же транзакции. */
    async refresh(token: string | undefined): Promise<TokenPair> {
        if (token === undefined) throw new UnauthorizedException('Требуется повторный вход');
        const database = this.database.effect;
        return Effect.runPromise(database.transaction(Effect.gen(function* (this: AuthenticationService) {
            const hash = this.tokenHash(token);
            const row = yield* database.get<TokenRow>(select('platform_tokens', {
                columns: ['userGuid', 'expiresAt', 'revokedAt'], where: [{ column: 'guid', operator: '=', value: hash }],
            }));
            if (row === undefined || row.revokedAt !== null || row.expiresAt <= new Date().toISOString()) {
                throw new UnauthorizedException('Токен обновления недействителен');
            }
            const user = yield* database.get<UserRow>(select('platform_users', {
                columns: ['guid', 'disabledAt'], where: [{ column: 'guid', operator: '=', value: row.userGuid }],
            }));
            if (user === undefined || user.disabledAt !== null) throw new UnauthorizedException('Требуется повторный вход');
            yield* database.run(update('platform_tokens', { revokedAt: new Date().toISOString() }, [
                { column: 'guid', operator: '=', value: hash }, { column: 'revokedAt', operator: '=', value: null },
            ]));
            const refresh = randomBytes(32).toString('base64url');
            yield* database.run(insert('platform_tokens', {
                guid: this.tokenHash(refresh), userGuid: row.userGuid,
                expiresAt: new Date(Date.now() + refreshLifetimeSeconds * 1000).toISOString(), revokedAt: null,
            }));
            const access = yield* Effect.promise(() => new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
                .setSubject(row.userGuid).setJti(this.tokenHash(refresh)).setIssuedAt().setExpirationTime(`${accessLifetimeSeconds}s`).sign(this.signingKey));
            return { access, refresh };
        }.bind(this))));
    }

    /** Отзывает предъявленный refresh-токен; повторный выход допускается. */
    async logout(token: string | undefined): Promise<void> {
        if (token === undefined) return;
        await Effect.runPromise(this.database.effect.run(update('platform_tokens', { revokedAt: new Date().toISOString() }, [
            { column: 'guid', operator: '=', value: this.tokenHash(token) },
            { column: 'revokedAt', operator: '=', value: null },
        ])));
    }
}
