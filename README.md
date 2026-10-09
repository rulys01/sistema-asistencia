# Sistema de Asistencia y Calificaciones

Aplicación web para registrar docentes, estudiantes, asistencia en tiempo real y calificaciones por parcial y trimestre, con reportes imprimibles y un módulo de consulta para estudiantes o tutores.

Construida con **Google Apps Script** y **Google Sheets** como base de datos. Interfaz con **Bootstrap 5.3**, tema claro y oscuro, y diseño adaptable a celulares.

**Desarrollador:** Mtro. Raúl Dionicio

---

## Contenido

- [Características](#características)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Flujo de trabajo diario](#flujo-de-trabajo-diario)
- [Base de datos (hojas)](#base-de-datos-hojas)
- [Reglas de cálculo](#reglas-de-cálculo)
- [Roles y permisos](#roles-y-permisos)
- [Módulo de invitado](#módulo-de-invitado)
- [Seguridad y privacidad](#seguridad-y-privacidad)
- [Solución de problemas](#solución-de-problemas)

---

## Características

| Módulo | Descripción |
|---|---|
| **Login** | Usuario y contraseña cifrada (SHA-256 con sal), sesión de 6 horas y bloqueo de 10 minutos tras 5 intentos fallidos. |
| **Docentes y asignaturas** | Registro de docentes y de cada asignatura con su grado, grupo y ciclo escolar. |
| **Estudiantes** | Alta, baja, edición, importación de listas pegadas desde Excel y ordenamiento alfabético. |
| **Asistencia** | Registro en tiempo real con un toque (Presente / Falta). Solicita el número de asistencias que cuentan para la evaluación de cada parcial. |
| **Actividades y calificaciones** | Criterios generales y actividades de libreta. Trae automáticamente el porcentaje de asistencia y calcula la calificación. |
| **Reportes** | Evaluación formativa, evaluación final y lista de asistencia, con logotipo y encabezado de la institución. Impresión y PDF. |
| **Permisos** | Matriz de roles con Ver, Crear, Editar y Eliminar por módulo. Permite crear roles nuevos. |
| **Invitado** | Consulta de un solo estudiante con matrícula y clave, mostrando todos sus trimestres y parciales. |

---

## Estructura del repositorio

```
sistema-asistencia/
├── src/
│   ├── Code.gs            # Servidor: lógica, base de datos, seguridad y cálculos
│   ├── Index.html         # Interfaz: HTML, CSS y JavaScript del cliente
│   └── appsscript.json    # Manifiesto del proyecto de Apps Script
├── .clasp.json            # Vincula la carpeta con el proyecto (lo genera clasp)
├── .gitignore
└── README.md
```

---

## Requisitos

- Cuenta de Google.
- [Node.js](https://nodejs.org) (versión LTS), [Git](https://git-scm.com) y [Visual Studio Code](https://code.visualstudio.com).
- [clasp](https://github.com/google/clasp), la herramienta de línea de comandos de Apps Script.
- Una hoja de cálculo de Google vacía, que será la base de datos.
- La **API de Apps Script** activada en <https://script.google.com/home/usersettings>.

---

## Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/TU_USUARIO/sistema-asistencia.git
cd sistema-asistencia
```

### 2. Instalar clasp e iniciar sesión

```bash
npm install -g @google/clasp
clasp login
```

### 3. Vincular el proyecto a tu hoja de cálculo

Copia el ID de tu hoja desde su URL:
`https://docs.google.com/spreadsheets/d/`**`ID_DE_LA_HOJA`**`/edit`

```bash
clasp create --type sheets --title "Sistema de Asistencia" --parentId ID_DE_LA_HOJA --rootDir ./src
```

Esto genera `.clasp.json`. Asegúrate de que tenga este formato:

```json
{
  "scriptId": "ID_GENERADO_POR_CLASP",
  "rootDir": "./src",
  "fileExtension": "gs"
}
```

> El script debe quedar **vinculado a la hoja**, porque `instalar()` usa la hoja activa como base de datos.

Si clasp generó un `appsscript.json` nuevo, conserva el de este repositorio (carpeta `src/`).

### 4. Subir el código

```bash
clasp push
```

### 5. Crear la base de datos

Abre el editor web con `clasp open` y ejecuta, en este orden:

1. `instalar()` — crea las hojas, los permisos base y el usuario administrador.
2. `cargarDatosDeEjemplo()` — *opcional*; carga un docente, una asignatura y la lista de estudiantes de ejemplo.

La primera vez Google mostrará "app no verificada": elige **Configuración avanzada → Ir a Sistema de Asistencia** y acepta los permisos.

**Acceso inicial:** usuario `admin` · contraseña `Admin2026*`
El sistema obliga a cambiarla en el primer ingreso.

### 6. Publicar la aplicación web

```bash
clasp deploy --description "v1.0 inicial"
clasp deployments
```

La URL final es `https://script.google.com/macros/s/ID_DE_IMPLEMENTACION/exec`.

El manifiesto ya configura *Ejecutar como: yo* y *Acceso: cualquier persona*. Esto es necesario para que el módulo de invitado funcione sin cuenta de Google; el personal se identifica con su usuario y contraseña del sistema.

### 7. Configuración inicial desde la aplicación

1. Entra con `admin` y cambia la contraseña.
2. En **Configuración** captura el nombre de la institución, el encabezado, la C.C.T., el ciclo y sube el logotipo.
3. En **Docentes y asignaturas** registra docentes y asignaturas con su grado y grupo.
4. En **Usuarios** crea las cuentas del personal y vincúlalas a su docente.
5. En **Estudiantes** carga las listas de cada grupo.

---

## Flujo de trabajo diario

```bash
# 1. Editar el código en VS Code

# 2. Respaldar en GitHub
git add .
git commit -m "Descripción del cambio"
git push

# 3. Subir a Apps Script
clasp push

# 4. Actualizar la aplicación publicada (misma URL)
clasp deploy -i ID_DE_IMPLEMENTACION -d "v1.1"
```

Usa siempre `-i ID_DE_IMPLEMENTACION`; sin ese parámetro, clasp crea una URL nueva en cada despliegue. El ID se consulta con `clasp deployments`.

Para probar sin publicar, usa **Implementar → Probar implementaciones** en el editor web (URL terminada en `/dev`).

---

## Base de datos (hojas)

`instalar()` crea una hoja por entidad en tu hoja de cálculo:

| Hoja | Contenido |
|---|---|
| `Config` | Institución, encabezado, C.C.T., ciclo, director y logotipo. |
| `Usuarios` | Cuentas, rol, docente vinculado, sal y hash de contraseña. |
| `Permisos` | Matriz Rol × Módulo × (Ver, Crear, Editar, Eliminar). |
| `Docentes` | Catálogo de docentes. |
| `Asignaciones` | Asignatura, grado, grupo y ciclo de cada docente. |
| `Estudiantes` | Lista, matrícula, clave de consulta y etiqueta (ej. N.I.). |
| `Periodos` | Por clase, trimestre y parcial: total de días y peso de la asistencia. |
| `Asistencia` | Una fila por estudiante y fecha (1 = presente, 0 = falta). |
| `Actividades` | Criterios y actividades de cada parcial. |
| `Calificaciones` | Puntos capturados y observaciones. |

> **No edites estas hojas a mano** salvo que sepas lo que haces: la aplicación depende de sus encabezados y del formato de texto de varias columnas.

---

## Reglas de cálculo

Replican el formato original de Excel (`LISTA_ASISTENCIA_E.xlsx`):

| Concepto | Fórmula |
|---|---|
| Calificación de asistencia (0–10) | `REDONDEAR(asistencias × 10 ÷ total de días, 0)` |
| Puntos de asistencia | `calificación de asistencia ÷ 10 × peso de la asistencia` |
| Peso de libreta y actividades | `100 − (peso de asistencia + puntos de criterios generales)` |
| Puntos de libreta | `suma de actividades × peso de libreta ÷ suma de máximos` |
| **Calificación general del parcial** | `(asistencia + generales + libreta) ÷ 10` |
| Calificación del trimestre | `REDONDEAR(promedio de parciales, 0)` |
| **Calificación final** | `suma de trimestres ÷ 3`, a un decimal |

Mientras el ciclo está en curso, la calificación final se calcula con los trimestres que ya tienen datos y se marca como *parcial*.

---

## Roles y permisos

| Rol | Alcance base |
|---|---|
| **ADMIN** | Acceso total a todos los módulos y grupos. No se puede modificar. |
| **DOCENTE** | Estudiantes, asistencia y actividades de **sus propios grupos**; consulta de reportes. |
| **AUXILIAR** | Captura de asistencia y consulta de estudiantes, actividades y reportes. |

Desde el módulo **Permisos** se ajusta cada rol y se crean roles nuevos. Un usuario solo ve los grupos del docente al que está vinculado.

---

## Módulo de invitado

Desde la pantalla de acceso, la pestaña **Consulta de calificaciones** permite ver las notas de un solo estudiante sin iniciar sesión.

- Se necesitan la **matrícula** y la **clave de consulta** (6 dígitos), visibles para el personal en el módulo *Estudiantes*.
- Muestra únicamente al estudiante consultado, con todas sus asignaturas, trimestres y parciales.
- Tras 5 intentos fallidos se bloquea la consulta durante 10 minutos.
- La clave puede regenerarse en cualquier momento desde la ficha del estudiante.

---

## Seguridad y privacidad

- **Mantén este repositorio privado.** `Code.gs` incluye una lista de ejemplo con nombres de estudiantes (`LISTA_EJEMPLO`). Si vas a hacerlo público, elimina esa lista antes.
- Nunca subas `.clasprc.json` (credenciales de Google); ya está en `.gitignore`.
- Cambia de inmediato la contraseña del usuario `admin`.
- Las contraseñas se guardan con sal y hash; nunca en texto plano.
- Solo las funciones `doGet`, `infoPublica`, `login`, `consultaInvitado` y `api` son accesibles desde el navegador. Las demás terminan en `_` y son privadas.
- `instalar()` y `cargarDatosDeEjemplo()` solo pueden ejecutarse por el propietario del script desde el editor.
- Los textos que empiezan con `=`, `+`, `-` o `@` se neutralizan para evitar inyección de fórmulas en la hoja.
- Los datos de estudiantes son información personal: comparte la hoja de cálculo únicamente con quien deba administrarla.

---

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `User has not enabled the Apps Script API` | Activa la API en <https://script.google.com/home/usersettings> y espera unos minutos. |
| `clasp push` → `Request contains an invalid argument` | Verifica que `src/` contenga solo `Code.gs`, `Index.html` y `appsscript.json`; usa un manifiesto sin `oauthScopes`; revisa `clasp status`. |
| `Falta la hoja "Config"` | No se ejecutó `instalar()` o el script no está vinculado a la hoja. |
| La app pide iniciar sesión en Google | Redespliega con `clasp deploy -i ...` y confirma que el acceso sea *Cualquier persona*. |
| Cambié el código y no se refleja | La URL `/exec` sirve la versión desplegada: ejecuta `clasp deploy -i ID -d "..."`. |
| El PDF descargado se ve apretado | Usa **Imprimir / PDF** y elige orientación horizontal. |
| Nuevo permiso no autorizado | Ejecuta `instalar()` otra vez en el editor web para volver a autorizar. |

---

## Créditos

Desarrollado por **Mtro. Raúl Dionicio**.
