import { Subject, of } from 'rxjs';
import { AccountStore } from './accounts.store';
import { AccountApis } from '../infrastructure/accounts-api';
import { AuthResponse } from '../infrastructure/account-response';

describe('AccountStore session', () => {
  afterEach(() => localStorage.removeItem('currentUser'));

  it('shares concurrent refresh and persists only profile fields', async () => {
    const reply = new Subject<AuthResponse>();
    const api = jasmine.createSpyObj<AccountApis>('AccountApis', ['refresh']);
    api.refresh.and.returnValue(reply);
    const store = new AccountStore(api);
    const first = store.refreshToken();
    const second = store.refreshToken();
    expect(first).toBe(second);
    reply.next({ id: 1, email: 'example@example.test', fullName: 'Test', role: 'USER_STANDARD', token: 'ephemeral' });
    reply.complete();
    expect(await first).toBeTrue();
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('currentUser')).not.toContain('ephemeral');
  });

  it('clears the profile and calls logout after a rotation already in progress', async () => {
    const reply = new Subject<AuthResponse>();
    const api = jasmine.createSpyObj<AccountApis>('AccountApis', ['refresh', 'logout']);
    api.refresh.and.returnValue(reply);
    api.logout.and.returnValue(of(undefined));
    const store = new AccountStore(api);
    const refresh = store.refreshToken();
    const logout = store.logout();
    expect(api.logout).not.toHaveBeenCalled();
    reply.next({ id: 1, email: 'example@example.test', fullName: 'Test', role: 'USER_STANDARD' });
    reply.complete();
    expect(await refresh).toBeFalse();
    expect(await logout).toBeTrue();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(store.getCurrentUser()).toBeNull();
  });
});
