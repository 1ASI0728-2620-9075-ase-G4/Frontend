import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import { User } from '../domain/model/user.entity';
import { AccountApis } from '../infrastructure/accounts-api';
import { AuthResponse } from '../infrastructure/account-response';

const CURRENT_USER_KEY = 'currentUser';

@Injectable({ providedIn: 'root' })
export class AccountStore {
    private refreshing: Promise<boolean> | null = null;
    private signingOut: Promise<boolean> | null = null;

    constructor(private readonly api: AccountApis) {}

    async register(user: User): Promise<{ ok: boolean; message?: string }> {
        try {
            const payload = { email: user.email, password: user.password, fullName: user.name };
            const resp = await lastValueFrom(this.api.register(payload));
            this.saveSession(resp);
            return { ok: true };
        } catch (err: any) {
            const body = err?.error;
            const message: string | undefined =
                body?.errors?.[0]?.defaultMessage ??
                body?.message ??
                undefined;
            return { ok: false, message };
        }
    }

    async login(email: string, password: string): Promise<boolean> {
        try {
            const resp = await lastValueFrom(this.api.login(email, password));
            this.saveSession(resp);
            return true;
        } catch {
            return false;
        }
    }

    async markAsPaid(email: string): Promise<void> {
        console.warn('[AccountStore] markAsPaid not implemented. Email:', email);
    }

    /** Actualiza el nombre del perfil en el backend y refresca el usuario guardado. */
    async updateProfile(fullName: string): Promise<{ ok: boolean; message?: string }> {
        try {
            const resp = await lastValueFrom(this.api.updateProfile(fullName));
            this.saveSession(resp);
            return { ok: true };
        } catch (err: any) {
            return { ok: false, message: err?.error?.message };
        }
    }

    /** Cambia la contraseña del usuario autenticado. */
    async changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; message?: string }> {
        try {
            await lastValueFrom(this.api.changePassword(currentPassword, newPassword));
            return { ok: true };
        } catch (err: any) {
            return { ok: false, message: err?.error?.message };
        }
    }

    private saveSession(resp: AuthResponse): void {
        // El token NO se guarda en localStorage: viaja solo en la cookie HttpOnly (seguro ante XSS).
        const userInfo = {
            id: resp.id,
            email: resp.email,
            fullName: resp.fullName,
            role: resp.role,
        };
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(userInfo));
    }

    getCurrentUser(): Omit<AuthResponse, 'token'> | null {
        const raw = localStorage.getItem(CURRENT_USER_KEY);
        if (!raw) return null;
        try { return JSON.parse(raw) as Omit<AuthResponse, 'token'>; }
        catch { return null; }
    }

    logout(): Promise<boolean> {
        localStorage.removeItem(CURRENT_USER_KEY);
        return this.signingOut ??= this.endSession().finally(() => { this.signingOut = null; });
    }

    private async endSession(): Promise<boolean> {
        try {
            await this.refreshing;
            localStorage.removeItem(CURRENT_USER_KEY);
            await lastValueFrom(this.api.logout());
            return true;
        } catch {
            return false;
        }
    }

    isLogged(): boolean {
        return !!this.getCurrentUser();
    }

    /**
     * Renueva el access token usando el refreshToken (cookie). Devuelve true si se renovó.
     * Usado por el interceptor ante un 401 antes de desloguear.
     */
    refreshToken(): Promise<boolean> {
        if (this.signingOut) return Promise.resolve(false);
        return this.refreshing ??= lastValueFrom(this.api.refresh()).then(
            response => {
                if (!this.signingOut) this.saveSession(response);
                return !this.signingOut;
            },
            () => false,
        ).finally(() => { this.refreshing = null; });
    }

    /**
     * Refresca la sesión tras un cambio de rol (ej. upgrade a premium): pide un token nuevo
     * con el rol actualizado y actualiza el usuario guardado. Necesario para que @PreAuthorize premium aplique.
     */
    async refreshAfterRoleChange(): Promise<void> {
        await this.refreshToken();
        try {
            const me = await lastValueFrom(this.api.getMe());
            this.saveSession(me);
        } catch { /* ignore */ }
    }

    getRole(): string | null {
        return this.getCurrentUser()?.role ?? null;
    }

    isPremium(): boolean {
        const role = this.getRole();
        return role === 'USER_PREMIUM' || role === 'ADMIN';
    }

    /**
     * Intenta restaurar la sesion llamando a GET /me con la cookie HttpOnly.
     * Usado por el authGuard despues de un login OAuth2 donde localStorage esta vacio.
     * Retorna true si la sesion fue restaurada, false si no hay sesion activa.
     */
    async tryRestoreSession(): Promise<boolean> {
        try {
            const resp = await lastValueFrom(this.api.getMe());
            this.saveSession(resp);
            return true;
        } catch (error) {
            return error instanceof HttpErrorResponse && error.status === 401
                ? this.refreshToken() : false;
        }
    }
}
