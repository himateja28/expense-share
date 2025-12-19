const API = (() => {
  const baseUrl = 'https://expense-share-newz.onrender.com/';

  function useAuthFetch(token, onUnauthorized) {
    return async (path, options = {}) => {
      const headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const isJson = res.headers.get('content-type')?.includes('application/json');
      const payload = isJson ? await res.json() : await res.text();
      if (res.status === 401 && token) {
        onUnauthorized?.();
      }
      if (!res.ok) throw new Error(isJson ? payload.error || 'Request failed' : payload || 'Request failed');
      return payload;
    };
  }

  return { baseUrl, useAuthFetch };
})();
