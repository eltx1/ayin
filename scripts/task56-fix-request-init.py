from pathlib import Path

path = Path("apps/web/src/components/admin/admin-series-catalog.tsx")
text = path.read_text()
old = '''      const response = await fetch(`${apiBaseUrl}${url}`, {
        credentials: "include",
        ...init,
        headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
      });'''
new = '''      const requestInit: RequestInit = { ...init, credentials: "include" };
      if (init.body) {
        const headers = new Headers(init.headers);
        headers.set("content-type", "application/json");
        requestInit.headers = headers;
      }
      const response = await fetch(`${apiBaseUrl}${url}`, requestInit);'''
if old not in text:
    raise SystemExit("mutate fetch marker not found")
path.write_text(text.replace(old, new, 1))
