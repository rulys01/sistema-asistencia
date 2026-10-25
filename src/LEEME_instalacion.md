# Sistema de Asistencia y Calificaciones · v2.0
Desarrollador: Mtro. Raúl Dionicio

## Archivos del proyecto (Apps Script)
| Archivo | Contenido |
|---|---|
| `Codigo.gs` | Constantes, esquema de la BD, instalación, migración, disparadores |
| `Datos.gs` | Capa de datos: caché, lectura por clase, borrado lógico, auditoría, hojas por ciclo |
| `Nucleo.gs` | Sesión, login con Google, recuperación por correo, permisos, alcance |
| `Motor.gs` | Cálculo de calificaciones, resultados precalculados, invitado, indicadores |
| `Api.gs` | Todas las acciones del personal autenticado |
| `Servicios.gs` | Sanitizador de HTML para PDF, respaldos, correo, archivos de Drive |
| `Pruebas.gs` | Pruebas unitarias (`ejecutarPruebas`) |
| `Index.html` + `css_app.html` + `js_*.html` (12) | Interfaz dividida con `include()` |
| `appsscript.json` | Manifiesto (zona horaria y despliegue) |

> El archivo que antes se llamaba `Indix.html` debe llamarse exactamente **`Index`**.

## Instalación nueva
1. Crea una hoja de cálculo de Google → **Extensiones → Apps Script**.
2. Crea cada archivo con el **mismo nombre** (los `.gs` como *Script*, los `.html` como *HTML*; sin la extensión en el editor). En *Configuración del proyecto* activa “Mostrar `appsscript.json`” y pega el manifiesto.
3. Ejecuta **`instalar`** (autoriza permisos: Hojas, Drive, Correo, Disparadores). Crea las 15 hojas, el usuario `admin` / `Admin2026*` (te pedirá cambiarla) y los disparadores.
4. Ejecuta **`ejecutarPruebas`** y revisa el registro: deben pasar todas.
5. **Implementar → Nueva implementación → Aplicación web**: *Ejecutar como: yo* · *Acceso: cualquier persona*.

## Si ya usas la versión 1 (con datos)
Pega los archivos nuevos y ejecuta **`instalar`** de nuevo. Agrega las columnas nuevas **al final** de cada hoja sin tocar tus datos, crea `Inscripciones` a partir de tus estudiantes y deja el esquema 3×2 en tus asignaturas. Nada se borra.

## Inicio con Google (Workspace)
`Session.getActiveUser()` solo entrega el correo de quien visita cuando la aplicación es del **mismo dominio**. Como la consulta pública de tutores/estudiantes necesita acceso abierto, usa **dos implementaciones del mismo código**:
- **Pública** (acceso: cualquier persona): usuario/contraseña y consulta de calificaciones.
- **Del dominio** (acceso: cualquier usuario de tu dominio): botón “Iniciar con Google” para el personal.

En **Usuarios**, captura el correo de Google de cada persona. Ese mismo correo se usa para “¿Olvidaste tu contraseña?”.

## Qué se implementó
- **Seguridad:** login con Google, recuperación por correo (código de 6 dígitos, 15 min, un solo uso, cierra sesiones abiertas), **bitácora** con valor anterior y posterior (sin hashes ni claves), depuración automática.
- **Rendimiento:** caché versionada, lectura filtrada por `ClaseID`, **archivado por ciclo** en hojas propias, **resultados precalculados** para la consulta de invitado (se recalculan al cambiar datos o cada 10 min).
- **Datos:** `Inscripciones` (historial y promoción de grupo), **borrado lógico + Papelera**, asistencia con **retardo / justificada / permiso** (valor configurable).
- **Funciones:** panel con indicadores y gráfica, correo a tutores, **esquemas de evaluación configurables**, importar/exportar Excel-CSV, **pase de lista por QR**, boleta individual y reporte por grupo, **respaldo diario** a Drive, **seguimiento** con adjuntos, **modo sin conexión**.
- **Código:** interfaz en 14 archivos, pruebas unitarias del motor y HTML de PDF validado con lista blanca.

## Límites a tener presentes
- **Sin conexión:** Apps Script no permite instalar un *service worker*, así que no es una PWA instalable. Con la pestaña abierta, asistencia y calificaciones se guardan en el dispositivo y se envían al reconectar.
- **Cámara QR:** algunos navegadores bloquean la cámara dentro del marco de Apps Script. Si pasa, abre la aplicación en pestaña completa o usa lector USB / campo manual.
- **Correo:** cuota diaria de Google (≈100 cuentas personales, ≈1,500 Workspace).
- **Archivado:** un ciclo archivado queda de solo lectura hasta reabrirlo; no se puede archivar el ciclo vigente.
- **Instalación de disparadores:** si cambias de propietario del script, ejecuta `instalarTriggers`.
