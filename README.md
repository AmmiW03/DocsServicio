# DocsServicio

DocsServicio es un cliente web ligero para consultar la información documental de proyectos GitLab desde una sola interfaz. Permite iniciar sesión con GitLab, localizar proyectos accesibles para el usuario, leer sus wikis y consultar sus releases y descargas asociadas.

La aplicación está pensada como un cliente local o desplegable en un único servicio. El navegador nunca llama directamente a la API de GitLab ni conoce el token OAuth: el servidor local gestiona la autenticación, conserva la sesión y reenvía las peticiones autenticadas.

## Qué problema resuelve

GitLab ya ofrece estas funciones, pero están distribuidas entre la navegación de proyectos, la wiki y los releases. DocsServicio proporciona una vista enfocada en documentación:

- Lista los proyectos de los que el usuario es miembro y permite filtrar los que tienen wiki.
- Agrupa proyectos por namespace y ofrece búsqueda local.
- Carga el índice de páginas de una wiki y permite buscar por título o contenido.
- Muestra páginas Markdown con formato, sanitización HTML y resaltado de bloques de código.
- Muestra releases ordenados por fecha, notas de publicación, tags y assets descargables.
- Mantiene la navegación como SPA mediante rutas hash, sin un bundler ni una fase de compilación.

La interfaz actual es de lectura. La capa API ya contiene operaciones `POST`, `PUT` y `DELETE` para futuras funciones de edición de wikis, pero esas operaciones todavía no están conectadas a la UI.

## Arquitectura y elección de tecnologías

### Backend

- **Node.js con ES modules**: proporciona el servidor y las APIs nativas `fetch`, `crypto` y `http` sin incorporar un framework para una aplicación pequeña.
- **Servidor HTTP nativo** en `server.js`: sirve archivos estáticos, controla OAuth, crea sesiones y funciona como proxy hacia GitLab REST API v4.
- **Variables de entorno**: separan la configuración de GitLab y del despliegue del código. `npm start` usa el soporte de Node para cargar `.env` si existe.
- **Sesiones en memoria**: un `Map` relaciona una cookie aleatoria con el token de GitLab. Es sencillo para desarrollo, pero no es persistente ni adecuado para varias instancias en producción.

### Frontend

- **HTML, CSS y JavaScript ES modules sin framework**: reduce la superficie del proyecto y permite abrir una interfaz rápida sin compilación. `scripts/app.js` inicializa la aplicación.
- **Router hash propio**: las rutas `#/...` cambian la vista sin que el servidor tenga que resolver rutas del frontend.
- **Store reactivo pequeño**: `scripts/store/state.js` usa un patrón pub/sub para compartir usuario, proyectos, wiki seleccionada, página actual, carga y errores.
- **Módulos API separados por dominio**: `projects.js`, `wiki.js` y `releases.js` encapsulan las rutas de GitLab; `client.js` centraliza errores, credenciales, JSON y paginación completa mediante `X-Next-Page`.
- **Librerías CDN**: `marked` convierte Markdown a HTML, `DOMPurify` sanea el resultado y `highlight.js` resalta código. Se cargan desde jsDelivr en `index.html`, por lo que el navegador necesita acceso a esa CDN.

### Seguridad

- OAuth 2.0 usa Authorization Code con **PKCE S256** y el parámetro `state` para proteger el retorno de autenticación.
- El intercambio del código por tokens ocurre en el backend. El `client_secret` solo se envía cuando `GITLAB_OAUTH_CONFIDENTIAL=true` y está configurado.
- La sesión del navegador usa una cookie `HttpOnly`, `SameSite=Lax` y, en producción, `Secure`.
- El frontend consulta `/api/me` para saber quién está autenticado; el token de GitLab no se guarda en `localStorage` ni se expone al JavaScript de la aplicación.
- El logger mantiene un buffer local de diagnósticos, limita su tamaño y redacta claves sensibles como tokens, secretos, contraseñas y cabeceras `Authorization`.

## Flujo de conexión

1. El usuario abre `/` y `app.js` comprueba la sesión llamando a `GET /api/me`.
2. Si no existe una sesión válida, el router dirige a `#/auth`.
3. Al pulsar **Conectar con GitLab**, el navegador navega a `/auth/login`.
4. El backend genera `state` y un verificador PKCE de un solo uso, y redirige a GitLab con los scopes `api read_user read_repository`.
5. GitLab autentica al usuario, incluyendo contraseña, MFA o SSO, y vuelve a `/auth/callback` con un código.
6. El backend valida `state`, intercambia el código usando el verificador PKCE y crea una sesión interna. Después establece la cookie `session` y redirige a `#/projects`.
7. Cada llamada del frontend a `/api/...` incluye automáticamente la cookie. El backend valida la sesión, añade `Authorization: Bearer <token>` y reenvía la solicitud a `GITLAB_URL/api/v4/...`.
8. Al cerrar sesión, `GET /auth/logout` elimina la sesión, intenta revocar el token en GitLab y borra la cookie.

El token y el `refresh_token` se mantienen en la sesión del servidor. Aunque se guarda la fecha de expiración recibida por GitLab, el servidor actual no implementa renovación automática; una sesión cuyo token expire debe volver a autenticarse.

## Rutas de la aplicación

| Ruta | Vista | Función |
| --- | --- | --- |
| `#/auth` | `AuthView` | Inicio de sesión |
| `#/projects` | `ProjectsView` | Proyectos accesibles |
| `#/wiki/:projectId` | `WikiView` | Índice de la wiki y página `home` si existe |
| `#/wiki/:projectId/:slug` | `WikiView` | Página wiki concreta |
| `#/releases/:projectId` | `ReleasesView` | Releases, tags y descargas |

Las rutas de vista salvo `#/auth` están protegidas por el router. Si no hay sesión, redirigen a `#/auth`.

## Estructura del proyecto

```text
server.js                 Servidor HTTP, OAuth, sesiones y proxy GitLab
index.html                Documento raíz, estilos y librerías CDN
scripts/app.js             Bootstrap y asociación de rutas con vistas
scripts/api/client.js      Cliente REST, errores y paginación
scripts/api/projects.js    Operaciones de proyectos
scripts/api/wiki.js        Lectura y CRUD preparado de wikis
scripts/api/releases.js    Consulta de releases
scripts/auth/oauth.js      Helpers OAuth/PKCE del frontend
scripts/auth/session.js    Estado de autenticación y logout
scripts/store/state.js     Store pub/sub de la interfaz
scripts/ui/router.js       Router hash y guards de autenticación
scripts/ui/views/          Auth, proyectos, wiki y releases
scripts/ui/components/     Árbol, búsqueda, breadcrumb y render wiki
scripts/lib/logger.js      Logs estructurados y redacción de secretos
styles/                    CSS global y estilos por vista
```

## Requisitos

- Node.js 22 o una versión posterior compatible con `--env-file-if-exists`.
- Una aplicación OAuth registrada en GitLab.
- Acceso de red desde el servidor hacia GitLab.
- Acceso del navegador a jsDelivr si se quieren cargar las librerías de renderizado y resaltado.

No hay `npm install` ni proceso de build: `package.json` solo define el script de arranque y el proyecto utiliza APIs nativas de Node.

## Configuración de GitLab

En GitLab.com crea una aplicación OAuth en **User Settings > Applications** con:

- Redirect URI local: `http://localhost:8000/auth/callback`
- Scopes: `api`, `read_user`, `read_repository`
- Aplicación no confidencial (`Confidencial: No`) para que el secret sea opcional.

El scope `api` permite que el proxy pueda cubrir las operaciones REST previstas, incluidas las futuras operaciones de edición. Concede únicamente los permisos y el acceso GitLab que sean apropiados para el despliegue.

## Ejecución local

El archivo `.env.example` contiene la configuración mínima:

```bash
cd /Users/ammi/DocsServicio
cp .env.example .env
# Edita .env y coloca el Client ID de tu aplicación OAuth
npm start
```

Abre `http://localhost:8000/`. No uses `python3 -m http.server`: ese servidor no conoce las rutas `/auth/*` y `/api/*` ni puede actuar como proxy autenticado.

Variables disponibles:

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `GITLAB_URL` | No | Instancia GitLab; por defecto `https://gitlab.com`. |
| `GITLAB_CLIENT_ID` | Sí | Application ID de la aplicación OAuth. |
| `GITLAB_CLIENT_SECRET` | Condicional | Secret para aplicaciones confidenciales. |
| `GITLAB_OAUTH_CONFIDENTIAL` | No | `true` añade el secret al intercambio; por defecto es `false`. |
| `GITLAB_REDIRECT_URI` | Producción | URI exacta registrada en GitLab. En local se genera con el puerto. |
| `PORT` | No | Puerto HTTP; por defecto `8000`. |
| `NODE_ENV` | No | Con `production` activa la cookie `Secure` y exige redirect URI explícita. |
| `ZAMMAD_URL` | Para soporte | URL base de Zammad, sin `/api/v1`. |
| `ZAMMAD_TOKEN` | Para soporte | Token de API de Zammad. Solo se lee en el servidor y nunca se envía al navegador. |
| `ZAMMAD_GROUP_ID` | No | Grupo de Zammad para los tickets; por defecto `1`. Confírmalo con `/api/v1/groups`. |
| `SUPPORT_QA_USERNAMES` | No | Usuarios GitLab separados por comas que pueden crear un ticket a nombre de otro correo. |
| `SUPPORT_ADMIN_USERNAMES` | Para licencias | Usuarios GitLab separados por comas que pueden subir licencias desde el panel de administración. |
| `GITLAB_LICENSES_PROJECT_ID` | Para licencias | ID del repositorio privado donde se almacenan los PDF y el registro de licencias. |
| `GITLAB_LICENSES_TOKEN` | Para licencias | Token de servidor (project access token con `read_repository` y `write_repository`) para leer y escribir el repositorio de licencias. Nunca se envía al navegador. |
| `GITLAB_LICENSES_BRANCH` | No | Rama del repositorio de licencias; por defecto `main`. |

Las licencias se guardan íntegramente en un repositorio privado de GitLab: el panel de administración sube cada PDF y mantiene un registro `licenses-registry.json` (comprometido en la raíz del mismo repositorio) que asocia cada documento a un `project_id` y a un `gitlab_username`:

```json
[
	{
		"id": "lic-001",
		"project_id": 123,
		"gitlab_username": "tu_usuario_gitlab",
		"filename": "licencia.pdf",
		"mime_type": "application/pdf",
		"storage_type": "gitlab",
		"gitlab_file_path": "123/1693845123-licencia.pdf",
		"expires_at": "2027-09-03"
	}
]
```

El registro lo actualiza también el servidor mediante `GITLAB_LICENSES_TOKEN`, por lo que ni el admin ni el cliente necesitan acceso directo al repositorio de licencias. Los endpoints comprueban la sesión, el acceso del usuario al proyecto y la coincidencia de `gitlab_username` (o `gitlab_user_id`, en formatos antiguos) antes de listar, visualizar o descargar un documento.

### Soporte y reportes

Cada proyecto muestra un botón **Soporte** junto a **Releases**. El formulario usa el correo del usuario autenticado en GitLab, no un correo introducido por el navegador. El servidor busca o crea el cliente en Zammad y crea el ticket en `POST /api/v1/tickets`, enviando el proyecto como el campo personalizado `sistema`.

Los tickets son **por proyecto y por cliente**: el listado filtra por el campo `sistema` del ticket contra el proyecto visitado, de modo que un reporte creado para un proyecto no aparece en otro.

La vista también muestra los tickets del usuario, su estado y una conversación con soporte. Tanto la creación del reporte como los mensajes del chat admiten **evidencia adjunta** (imágenes JPG, PNG, GIF, WebP o PDF): el navegador envía los archivos en `multipart/form-data` al backend, que los convierte a base64 y los entrega a la API de Zammad como `attachments` del artículo. Las imágenes se muestran en miniatura en la conversación y el resto de adjuntos como enlace de descarga.

Un ticket cerrado se reabre mediante el motivo obligatorio definido por Zammad. Para que QA levante un ticket a nombre de un usuario, agrega su `username` de GitLab a `SUPPORT_QA_USERNAMES`; el servidor rechaza cualquier correo destinatario enviado por usuarios no autorizados.

Configura `ZAMMAD_URL`, `ZAMMAD_TOKEN` y `ZAMMAD_GROUP_ID` en `.env`. El `priority_id` usado por el formulario debe coincidir con los catálogos del ambiente de Zammad; revisa `/api/v1/ticket_priorities` antes de producción y ajusta los valores del formulario si son distintos.

Los usuarios no introducen el Client ID ni ninguna variable: solo visitan la aplicación y se autentican en GitLab.

## Producción

Configura las variables como secretos del servicio y no subas `.env` al repositorio:

```text
NODE_ENV=production
GITLAB_URL=https://gitlab.com
GITLAB_CLIENT_ID=tu-application-id
GITLAB_CLIENT_SECRET=tu-application-secret
GITLAB_OAUTH_CONFIDENTIAL=false
GITLAB_REDIRECT_URI=https://tu-dominio.com/auth/callback
PORT=8000
```

Registra exactamente la misma Redirect URI en GitLab. Usa HTTPS para que la cookie `Secure` y el código OAuth viajen protegidos. Si despliegas más de una instancia, sustituye el `Map` de sesiones por un almacén compartido y añade expiración y limpieza de sesiones. También conviene configurar un proxy TLS, límites de tamaño y una política de logs adecuada al proveedor.

## Límites actuales y evolución

- Las sesiones y los estados OAuth viven en memoria: reiniciar el proceso cierra las sesiones y elimina los estados pendientes.
- No hay persistencia de datos propia; GitLab es la fuente de verdad.
- La búsqueda de wiki es local porque GitLab CE no ofrece un endpoint de búsqueda full-text de wiki usado por este cliente.
- Las páginas `markdown` se renderizan; `rdoc`, `asciidoc` y `org` se muestran como texto preformateado.
- La edición está preparada en `scripts/api/wiki.js`, pero requiere un editor y conectar sus eventos en `WikiView`.
- La sección **Licencias** vive dentro de cada wiki y permite previsualizar PDF, imágenes y texto, además de descargar los documentos asignados al usuario autenticado.
- No existen tests automatizados ni pipeline de build definidos en `package.json`; la verificación actual es manual y mediante los logs de diagnóstico.

## Diagnóstico

Los módulos escriben logs con niveles `debug`, `info`, `warn` y `error`. El buffer se guarda en `localStorage` para sobrevivir a recargas y al retorno de OAuth, con un máximo de 500 entradas. Desde la consola del navegador están disponibles:

```js
__glLogs.dump()      // Devuelve los logs como texto
__glLogs.download()  // Descarga un archivo de logs
__glLogs.entries()   // Devuelve las entradas actuales
__glLogs.clear()     // Borra el buffer
```

No compartas logs sin revisar su contenido, aunque el logger redacta datos sensibles automáticamente.