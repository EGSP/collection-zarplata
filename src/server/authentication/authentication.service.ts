import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Effect } from 'effect';
import { jwtVerify, SignJWT } from 'jose';
import type { DatabaseError } from '../database/database.errors.js';
import { DatabaseService } from '../database/database.service.js';
import { insert, select, update } from '../database/sql.builder.js';
import { SettingsService } from '../settings/settings.service.js';

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
export class AuthenticationService {
    private readonly signingKey: Uint8Array;

    constructor(
        private readonly database: DatabaseService,
        private readonly settings: SettingsService,
    ) {
        this.signingKey = createHmac('sha256', settings.pinHmacSecret).update('access-token').digest();
    }

    /**
     * HMAC PIN с секретом из настроек. Открыт для модуля первичных данных: начальных
     * пользователей он создаёт с тем же хешем, по которому их находит вход.
     */
    pinHash(pin: string): string {
        return createHmac('sha256', this.settings.pinHmacSecret).update(pin).digest('hex');
    }

    private tokenHash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    /**
     * `guid` активного пользователя с этим PIN или `undefined`, если такого нет или он отключён.
     * Тем же поиском пользуется модуль первичных данных, чтобы писать записи от имени начального пользователя.
     */
    activeUserGuid(pin: string): Effect.Effect<string | undefined, DatabaseError> {
        return this.database.effect.get<UserRow>(select('platform_users', {
            columns: ['guid', 'disabledAt'], where: [{ column: 'pinHash', operator: '=', value: this.pinHash(pin) }],
        })).pipe(Effect.map((user) => user === undefined || user.disabledAt !== null ? undefined : user.guid));
    }

    /** Находит активного пользователя по PIN и выдаёт пару; неверный PIN даёт 401. */
    async login(pin: string): Promise<TokenPair> {
        const userGuid = await Effect.runPromise(this.activeUserGuid(pin));
        if (userGuid === undefined) throw new UnauthorizedException('Неверный PIN');
        return this.issue(userGuid);
    }

    private async issue(userGuid: string): Promise<TokenPair> {
        const refresh = randomBytes(32).toString('base64url');
        const access = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
            .setSubject(userGuid).setJti(this.tokenHash(refresh)).setIssuedAt().setExpirationTime(`${this.settings.accessTokenLifetimeSeconds}s`).sign(this.signingKey);
        await Effect.runPromise(this.database.effect.run(insert('platform_tokens', {
            guid: this.tokenHash(refresh), userGuid,
            expiresAt: new Date(Date.now() + this.settings.refreshTokenLifetimeSeconds * 1000).toISOString(), revokedAt: null,
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
                expiresAt: new Date(Date.now() + this.settings.refreshTokenLifetimeSeconds * 1000).toISOString(), revokedAt: null,
            }));
            const access = yield* Effect.promise(() => new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
                .setSubject(row.userGuid).setJti(this.tokenHash(refresh)).setIssuedAt().setExpirationTime(`${this.settings.accessTokenLifetimeSeconds}s`).sign(this.signingKey));
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
