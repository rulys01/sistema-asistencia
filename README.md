<div align="center">

# 🎓 Sistema de Asistencia y Calificaciones

**Registro de asistencia en tiempo real, cálculo de calificaciones y reportes institucionales.**
Construido con Google Apps Script y Google Sheets.

![Plataforma](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)
![Base de datos](https://img.shields.io/badge/Google%20Sheets-34A853?logo=googlesheets&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap-5.3-7952B3?logo=bootstrap&logoColor=white)
![clasp](https://img.shields.io/badge/deploy-clasp-0d6efd)
![Estado](https://img.shields.io/badge/estado-v1.0-success)

Desarrollado por **Mtro. Raúl Dionicio**

</div>

---

## 📋 Descripción

Sistema web para docentes que sustituye las listas de asistencia y los formatos de evaluación en Excel. Los datos viven en una hoja de cálculo de Google, la aplicación se publica como página web y funciona en computadora y celular, con tema claro y oscuro.

Replica las fórmulas del formato institucional `LISTA_ASISTENCIA_E.xlsx`: asistencia, evaluación formativa por parcial, calificación por trimestre y evaluación final.

## ✨ Funcionalidades

- 🔐 **Login** con contraseñas cifradas y bloqueo por intentos fallidos.
- 👨‍🏫 **Docentes y asignaturas**, con grado, grupo y ciclo.
- 🧑‍🎓 **Estudiantes**: alta, baja, importación de listas y ordenamiento A–Z.
- ✅ **Asistencia en tiempo real**, con solicitud del número de asistencias para evaluación.
- 📝 **Actividades y calificaciones**, que traen el porcentaje de asistencia automáticamente.
- 📄 **Reportes** con logotipo y encabezado de la institución (impresión y PDF).
- 🛡️ **Permisos por rol** (ver, crear, editar, eliminar).
- 🔎 **Módulo de invitado** para consultar las calificaciones de un solo estudiante.

## 🗂️ Estructura del repositorio

```
sistema-asistencia/
├── src/
│   ├── Code.gs            # Servidor: lógica, base de datos, seguridad y cálculos
│   ├── Index.html         # Interfaz: HTML, CSS y JavaScript
│   └── appsscript.json    # Manifiesto del proyecto
├── .clasp.json            # Vínculo con Apps Script (lo genera clasp)
├── .gitignore
├── LICENSE                # (opcional) licencia del proyecto
└── README.md
```

## 🚀 Inicio rápido

### Requisitos

- Cuenta de Google y una **hoja de cálculo vacía** (será la base de datos).
- [Node.js LTS](https://nodejs.org), [Git](https://git-scm.com) y [VS Code](https://code.visualstudio.com).
- API de Apps Script activada en <https://script.google.com/home/usersettings>.

### Instalación

```bash
# 1. Clonar
git clone https://github.com/TU_USUARIO/sistema-asistencia.git
cd sistema-asistencia

# 2. Instalar clasp e iniciar sesión
npm install -g @google/clasp
clasp login

# 3. Crear el proyecto vinculado a tu hoja de cálculo
clasp create --type sheets --title "Sistema de Asistencia" --parentId ID_DE_LA_HOJA --rootDir ./src

# 4. Subir el código
clasp push
```

El ID de la hoja está en su URL: `https://docs.google.com/spreadsheets/d/`**`ID_DE_LA_HOJA`**`/edit`.

Verifica que `.clasp.json` quede así:

```json
{
  "scriptId": "ID_GENERADO_POR_CLASP",
  "rootDir": "./src",
  "fileExtension": "gs"
}
```

### Crear la base de datos

Abre el editor con `clasp open` y ejecuta, en este orden:

1. `instalar()` — crea las hojas, los permisos base y el usuario administrador.
2. `cargarDatosDeEjemplo()` — *opcional*, carga datos de demostración.

### Publicar

```bash
clasp deploy --description "v1.0"
clasp deployments
```

La aplicación queda en `https://script.google.com/macros/s/ID_DE_IMPLEMENTACION/exec`.

### Primer ingreso

| Usuario | Contraseña inicial |
|---|---|
| `admin` | `Admin2026*` |

El sistema pide cambiarla de inmediato. Después configura la institución y el logotipo en **Configuración**, registra docentes y asignaturas, crea los usuarios y carga las listas de estudiantes.

## 🔄 Flujo de trabajo

```bash
git add .
git commit -m "feat: descripción del cambio"
git push                                  # respaldo en GitHub
clasp push                                # sube a Apps Script
clasp deploy -i ID_DE_IMPLEMENTACION -d "v1.1"   # actualiza la misma URL
```

Usa siempre `-i ID_DE_IMPLEMENTACION`; sin él, clasp crea una URL nueva en cada despliegue.

## 🧮 Reglas de cálculo

| Concepto | Fórmula |
|---|---|
| Calificación de asistencia (0–10) | `REDONDEAR(asistencias × 10 ÷ total de días, 0)` |
| Peso de libreta y actividades | `100 − (asistencia + puntos generales)` |
| Puntos de libreta | `suma de actividades × peso de libreta ÷ suma de máximos` |
| **Calificación del parcial** | `(asistencia + generales + libreta) ÷ 10` |
| Calificación del trimestre | `REDONDEAR(promedio de parciales, 0)` |
| **Calificación final** | `suma de trimestres ÷ 3` (un decimal) |

## 👥 Roles

| Rol | Alcance |
|---|---|
| `ADMIN` | Acceso total. No se puede modificar. |
| `DOCENTE` | Estudiantes, asistencia y actividades de sus propios grupos; consulta de reportes. |
| `AUXILIAR` | Captura de asistencia y consulta de estudiantes, actividades y reportes. |

Desde el módulo **Permisos** se ajusta cada rol y se crean otros nuevos.

## 🔒 Seguridad y privacidad

> ⚠️ **Este proyecto maneja datos personales de estudiantes, algunos menores de edad.**

- **Mantén el repositorio privado.** `Code.gs` incluye una lista de ejemplo (`LISTA_EJEMPLO`) con nombres reales; elimínala antes de hacerlo público.
- Nunca subas `.clasprc.json` (credenciales de Google). Ya está en `.gitignore`.
- Cambia la contraseña de `admin` en el primer acceso.
- Comparte la hoja de cálculo solo con quien deba administrarla.
- Contraseñas almacenadas con sal y hash; nunca en texto plano.

## 🛠️ Solución de problemas

| Síntoma | Solución |
|---|---|
| `User has not enabled the Apps Script API` | Activa la API en <https://script.google.com/home/usersettings>. |
| `Request contains an invalid argument` | Verifica que `src/` tenga solo `Code.gs`, `Index.html` y `appsscript.json`; revisa `clasp status`. |
| `Falta la hoja "Config"` | Ejecuta `instalar()` y confirma que el script esté vinculado a la hoja. |
| La app pide iniciar sesión en Google | Redespliega con `clasp deploy -i ...` y acceso *Cualquier persona*. |
| Mis cambios no se ven | La URL `/exec` sirve la versión desplegada; ejecuta `clasp deploy -i ID`. |

---

## 🌱 Cómo iniciar este proyecto en GitHub (primera vez)

### 1. Crear el repositorio

En <https://github.com/new>:

- **Repository name:** `sistema-asistencia`
- **Visibility:** **Private**
- **No marques** *Add a README*, *.gitignore* ni *license* (ya los tienes localmente; marcarlos genera conflictos al primer push).

### 2. Crear el `.gitignore`

```gitignore
node_modules/
.clasprc.json
*.log
.DS_Store
.vscode/
```

### 3. Configurar tu identidad en Git (una sola vez)

```bash
git config --global user.name "Tu Nombre"
git config --global user.email "tu_correo@ejemplo.com"
```

### 4. Primer commit y push

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "feat: versión inicial del sistema de asistencia y calificaciones"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/sistema-asistencia.git
git push -u origin main
```

Si GitHub pide contraseña, usa un **Personal Access Token** (*Settings → Developer settings → Personal access tokens*) o inicia sesión desde VS Code con la extensión *GitHub Pull Requests*.

### 5. Ramas recomendadas

```bash
git checkout -b desarrollo        # trabajar aquí
git checkout main && git merge desarrollo   # liberar una versión estable
git tag v1.0 && git push --tags
```

### 6. Convención de commits (opcional)

| Prefijo | Uso |
|---|---|
| `feat:` | Nueva funcionalidad |
| `fix:` | Corrección de un error |
| `docs:` | Cambios en documentación |
| `style:` | Ajustes visuales sin cambiar lógica |
| `refactor:` | Reorganización de código |

### 7. Mejoras para el repositorio

- En *Settings → General*, agrega una descripción y *topics*: `google-apps-script`, `google-sheets`, `bootstrap`, `education`, `attendance`.
- Agrega una carpeta `docs/` con capturas de pantalla y enlázalas aquí.
- Elige una licencia en *Add file → Create new file → `LICENSE`* si algún día compartirás el código.
- Activa *Dependabot* y *secret scanning* en *Settings → Code security*.

## 🗺️ Ideas a futuro

- [ ] Exportar reportes a Excel.
- [ ] Gráficas de asistencia y aprovechamiento por grupo.
- [ ] Justificación de faltas y retardos.
- [ ] Aviso a tutores por correo.
- [ ] Respaldo automático programado de la hoja de cálculo.

## 📄 Licencia

Define aquí la licencia del proyecto (por ejemplo MIT) o indica *Todos los derechos reservados* si es de uso institucional.

## 👤 Autor

**Mtro. Raúl Dionicio** — Desarrollador del sistema.
