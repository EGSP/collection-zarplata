import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationService, type TokenPair } from './authentication.service.js';

const accessCookie = 'accessToken';
const refreshCookie = 'refreshToken';
const failureWindowMilliseconds = 15 * 60 * 1000;
const maximumFailures = 5;

/**
 * Принимает PIN и управляет HttpOnly-cookie. Ограничение попыток привязано к IP,
 * который Fastify определяет без доверия к заголовкам клиента, и живёт в процессе.
 */
@Controller('authentication')
export class AuthenticationController {
    private readonly failures = new Map<string, { count: number; until: number }>();

    constructor(private readonly authentication: AuthenticationService) {}

    private setCookies(reply: FastifyReply, request: FastifyRequest, tokens: TokenPair): void {
        const secure = request.protocol === 'https';
        reply.setCookie(accessCookie, tokens.access, {
            httpOnly: true, sameSite: 'strict', secure, path: '/api', maxAge: 15 * 60,
        });
        reply.setCookie(refreshCookie, tokens.refresh, {
            httpOnly: true, sameSite: 'strict', secure, path: '/api/authentication', maxAge: 7 * 24 * 60 * 60,
        });
    }

    /** Выдаёт cookie по PIN; после пяти ошибок блокирует адрес на 15 минут. */
    @Post('login')
    @HttpCode(HttpStatus.NO_CONTENT)
    async login(@Body() body: unknown, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
        const now = Date.now();
        const previous = this.failures.get(request.ip);
        if (previous !== undefined && previous.until > now && previous.count >= maximumFailures) {
            throw new HttpException('Слишком много попыток входа. Повторите позже', HttpStatus.TOO_MANY_REQUESTS);
        }
        if (previous !== undefined && previous.until <= now) this.failures.delete(request.ip);
        const pin = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)['pin'] : undefined;
        if (typeof pin !== 'string' || !/^[0-9]{4,12}$/.test(pin)) throw new BadRequestException('PIN должен содержать от 4 до 12 цифр');
        try {
            const tokens = await this.authentication.login(pin);
            this.failures.delete(request.ip);
            this.setCookies(reply, request, tokens);
        } catch (error) {
            if (error instanceof HttpException && error.getStatus() === HttpStatus.UNAUTHORIZED) {
                const current = this.failures.get(request.ip);
                this.failures.set(request.ip, { count: (current?.count ?? 0) + 1, until: current?.until ?? now + failureWindowMilliseconds });
            }
            throw error;
        }
    }

    /** Заменяет одноразовый refresh-токен и обновляет обе cookie. */
    @Post('refresh')
    @HttpCode(HttpStatus.NO_CONTENT)
    async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
        const tokens = await this.authentication.refresh(request.cookies[refreshCookie]);
        this.setCookies(reply, request, tokens);
    }

    /** Отзывает refresh-токен и удаляет cookie браузера. */
    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
        await this.authentication.logout(request.cookies[refreshCookie]);
        reply.clearCookie(accessCookie, { path: '/api' });
        reply.clearCookie(refreshCookie, { path: '/api/authentication' });
    }
}
