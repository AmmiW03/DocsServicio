# DocsServicio

Cliente de wikis de GitLab con autenticación OAuth 2.0 gestionada por un backend.

## Configuración de GitLab

En GitLab.com crea una aplicación OAuth en **User Settings > Applications**:

- Redirect URI: `http://localhost:8000/auth/callback`
- Scopes: `api`, `read_user`, `read_repository`
- Activa el flujo de autorización que use `client_secret`

El backend usa el Client ID y el Client Secret. Los usuarios no los introducen y sus contraseñas solo se escriben en GitLab.

## Ejecución local

Configura las variables en la terminal:

```bash
cd /Users/ammi/DocsServicio
export GITLAB_CLIENT_ID='tu-application-id'
export GITLAB_CLIENT_SECRET='tu-application-secret'
npm start
```

Abre `http://localhost:8000/`. No uses `python3 -m http.server` para esta versión, porque el backend debe gestionar `/auth/*` y `/api/*`.

La sesión se identifica mediante una cookie `HttpOnly`; el frontend no recibe ni almacena el token de GitLab. Las sesiones se guardan en memoria mientras el servidor está activo, por lo que para producción debe usarse un almacén de sesiones externo y HTTPS.