import {
  dismiss,
  makeRedirectUri,
  refreshAsync,
  revokeAsync,
  useAutoDiscovery,
} from 'expo-auth-session';
import { TokenResponse, useAuthRequest } from 'expo-auth-session';
import { AuthRequestConfig } from 'expo-auth-session/src/AuthRequest.types';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  NATIVE_REDIRECT_PATH,
  REFRESH_TIME_BUFFER,
  TOKEN_STORAGE_KEY,
} from './const';
import { getRealmURL } from './getRealmURL';
import { handleTokenExchange } from './handleTokenExchange';
import { KeycloakContext } from './KeycloakContext';
import useAsyncStorage from './useAsyncStorage';

export interface IKeycloakConfiguration extends Partial<AuthRequestConfig> {
  clientId: string;
  disableAutoRefresh?: boolean;
  nativeRedirectPath?: string;
  realm: string;
  refreshTimeBuffer?: number;
  scheme?: string;
  tokenStorageKey?: string;
  url: string;
}

export const KeycloakProvider = (
  props: React.PropsWithChildren<IKeycloakConfiguration>,
) => {
  const discovery = useAutoDiscovery(getRealmURL(props));

  const redirectUri = makeRedirectUri({
    native: `${props.scheme ?? 'exp'}://${
      props.nativeRedirectPath ?? NATIVE_REDIRECT_PATH
    }`,
    scheme: props.scheme ?? 'exp',
  });
  const [
    savedTokens,
    saveTokens,
    hydrated,
  ] = useAsyncStorage<TokenResponse | null>(
    props.tokenStorageKey ?? TOKEN_STORAGE_KEY,
    null,
  );
  const config: AuthRequestConfig = useMemo(() => ({ redirectUri, ...props }), [
    redirectUri,
    props,
  ]);

  const [request, response, promptAsync] = useAuthRequest(
    { usePKCE: false, ...config },
    discovery,
  );
  const [refreshHandle, setRefreshHandle] = useState<any>(null);

  const updateState = useCallback(
    (callbackValue: any) => {
      const tokens = callbackValue ?? null;
      if (!!tokens) {
        saveTokens(tokens);
        if (
          !props.disableAutoRefresh &&
          !!(tokens as TokenResponse).expiresIn
        ) {
          clearTimeout(refreshHandle);
          setRefreshHandle(
            setTimeout(
              () => refreshCallBackRef.current(),
              ((tokens as TokenResponse).expiresIn! -
                (props.refreshTimeBuffer ?? REFRESH_TIME_BUFFER)) *
                1000,
            ),
          );
        }
      } else {
        saveTokens(null);
        clearTimeout(refreshHandle);
        setRefreshHandle(null);
      }
    },
    [
      saveTokens,
      props.disableAutoRefresh,
      props.refreshTimeBuffer,
      refreshHandle,
    ],
  );
  const handleTokenRefresh = useCallback(() => {
    if (!hydrated || !discovery) return;
    if (!savedTokens && hydrated) {
      updateState(null);
      return;
    }
    if (TokenResponse.isTokenFresh(savedTokens!)) {
      updateState({ tokens: savedTokens });
    }

    refreshAsync(
      { refreshToken: savedTokens!.refreshToken, ...config },
      discovery!,
    )
      .catch(updateState)
      .then(updateState);
  }, [config, discovery, hydrated, savedTokens, updateState]);
  const handleLogin = useCallback(async () => {
    clearTimeout(refreshHandle);
    return promptAsync();
  }, [promptAsync, refreshHandle]);
  const handleLogout = useCallback(
    async (everywhere?: boolean) => {
      if (!savedTokens) throw new Error('Not logged in.');
      clearTimeout(refreshHandle);
      if (everywhere) {
        revokeAsync(
          { token: savedTokens?.accessToken!, ...config },
          discovery!,
        ).catch((e) => console.error(e));
        saveTokens(null);
      } else {
        dismiss();
        saveTokens(null);
      }
    },
    [config, discovery, refreshHandle, saveTokens, savedTokens],
  );

  const refreshCallBackRef = useRef(handleTokenRefresh);

  useEffect(() => {
    refreshCallBackRef.current = handleTokenRefresh;
  }, [handleTokenRefresh, savedTokens]);

  useEffect(() => {
    if (hydrated) refreshCallBackRef.current();
  }, [hydrated]);

  useEffect(() => {
    handleTokenExchange({ response, discovery, config }).then((res) => {
      if (res !== null) updateState(res.tokens);
    });
  }, [config, discovery, response, updateState]);

  return (
    <KeycloakContext.Provider
      value={{
        isLoggedIn: !props.disableAutoRefresh && !!savedTokens,
        login: handleLogin,
        logout: handleLogout,
        ready: request !== null,
        tokens: savedTokens,
      }}
    >
      {props.children}
    </KeycloakContext.Provider>
  );
};
