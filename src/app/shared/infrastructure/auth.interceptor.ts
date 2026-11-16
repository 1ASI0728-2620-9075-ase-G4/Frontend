import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AccountStore } from '../../accounts/application/accounts.store';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    if (!req.url.startsWith(environment.apiBaseUrl + '/')) return next(req);
    const store = inject(AccountStore);
    const router = inject(Router);

    // Cookie HttpOnly and a preflight marker only for writes to the configured API.
    const authReq = req.clone({
        withCredentials: true,
        headers: safeMethods.has(req.method) ? req.headers : req.headers.set('X-FreshSense-CSRF', 'traceability'),
    });

    const isAuthEndpoint =
        req.url.includes('/accounts/login') ||
        req.url.includes('/accounts/register') ||
        req.url.includes('/accounts/refresh') ||
        req.url.includes('/accounts/logout') ||
        req.url.includes('/accounts/me') ||
        req.url.includes('/billing/plans');

    return next(authReq).pipe(
        catchError((error: HttpErrorResponse) => {
            if (error.status === 401 && !isAuthEndpoint) {
                // Intenta renovar el access token (15 min) con el refresh token (7 días) antes de desloguear.
                return from(store.refreshToken()).pipe(
                    switchMap((renewed) => {
                        if (renewed) {
                            return next(authReq);
                        }
                        void store.logout().then(() => router.navigate(['/login']));
                        return throwError(() => error);
                    })
                );
            }
            return throwError(() => error);
        })
    );
};
