# Caracterización de Zonas de Expendios – MEBUC

Formulario de campo, base de datos de respuestas con fotos y panel con exportación a Excel.
Funciona sobre Cloudflare (Workers + D1 + R2).

| Parte | Dirección | Qué hace |
|---|---|---|
| Formulario | `https://<su-worker>.workers.dev/` | Registro del punto con GPS, dirección automática y cámara. |
| Panel | `https://<su-worker>.workers.dev/panel` | Todas las respuestas, fotos descargables, filtros y **Descargar Excel**. |

```
├── public/index.html   formulario
├── public/panel.html   panel de registros + Excel
├── src/index.js        API (Worker)
├── schema.sql          tablas de la base de datos
└── wrangler.toml       configuración de Cloudflare
```

---

## Instalación desde el navegador (sin usar la terminal)

Todo se hace en **https://dash.cloudflare.com** (cree una cuenta gratuita si no tiene).

### Paso 1 · Crear la base de datos
1. Menú **Storage & Databases → D1 SQL Database → Create**.
2. Nombre: `mebuc-caracterizacion` → **Create**.
3. Copie el **Database ID** (un código largo como `a1b2c3d4-...`).
4. Abra la pestaña **Console**, pegue todo el contenido de [`schema.sql`](schema.sql) y pulse **Execute**.

### Paso 2 · Poner el ID en `wrangler.toml`
1. En GitHub abra `wrangler.toml` → ícono del lápiz ✏️.
2. Reemplace `REEMPLAZAR_CON_EL_ID_DE_D1` por el Database ID del paso 1.
3. **Commit changes**.

### Paso 3 · Crear el almacenamiento de fotos
1. Menú **R2 Object Storage**. La primera vez Cloudflare pide activar R2 (puede pedir una tarjeta; los primeros 10 GB son gratis).
2. **Create bucket** → nombre: `mebuc-fotos` → **Create**.

### Paso 4 · Conectar este repositorio
1. Menú **Workers & Pages → Create → Import a repository**.
2. Conecte su cuenta de GitHub y elija **ENCUESTA**.
3. Nombre del proyecto: `mebuc-caracterizacion`. Deje *Build command* vacío y *Deploy command* `npx wrangler deploy`.
4. **Save and Deploy**. Desde ahora, cada cambio que se suba a GitHub se publica solo.

### Paso 5 · Crear las claves
En el Worker: **Settings → Variables and Secrets → Add**, tipo **Secret**:

| Nombre | Valor |
|---|---|
| `FORM_KEY` | Código que usarán los funcionarios en el formulario |
| `ADMIN_KEY` | Clave del panel (larga y diferente a la anterior) |
| `SIGNING_SECRET` | Texto aleatorio largo (40+ caracteres); nadie necesita recordarlo |

Pulse **Deploy** para aplicar.

### Paso 6 · Probar
- Abra la dirección `https://mebuc-caracterizacion.<su-cuenta>.workers.dev` en el celular, haga un registro de prueba con fotos.
- Abra `.../panel`, entre con la `ADMIN_KEY`, revise el registro y descargue el Excel.

---

## Uso

**Formulario**
- **📍 Obtener ubicación y dirección**: captura coordenadas y sugiere barrio, “Carrera X con Calle Y” y municipio (quedan en verde y se pueden corregir). Sin señal: escriba latitud/longitud y use “Buscar dirección”.
- **📷 Abrir cámara**: abre la cámara dentro de la página; ⟲ cambia de cámara. Hasta 6 fotos por sección.
- El código de acceso se escribe una vez y queda recordado en el dispositivo.

**Panel**
- Toque una fila para ver el detalle y descargar cada foto. Puede eliminar registros de prueba.
- **Descargar Excel** exporta lo filtrado: hoja *Caracterizaciones* (una columna por foto con enlace “Descargar foto” y enlace al mapa), hoja *Fotografías* y hoja *Información*.
- Los enlaces de fotos vencen a los 30 días (`LINK_DIAS` en `wrangler.toml`); después se descarga un Excel nuevo.

## Seguridad

- No se puede enviar sin `FORM_KEY` ni ver datos sin `ADMIN_KEY`. Las fotos solo se abren con enlaces firmados que vencen.
- Quien tenga el Excel puede bajar las fotos mientras el enlace esté vigente: compártalo solo dentro de la unidad.
- Recomendado: proteger `/panel*` y `/api/registros*` con **Cloudflare Access** (Zero Trust, gratis hasta 50 usuarios).
- Las claves nunca se escriben en el código ni en GitHub; solo en Cloudflare. Cambiar `SIGNING_SECRET` invalida todos los enlaces anteriores.

## Pruebas locales (opcional, para desarrolladores)

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev            # http://localhost:8787  y  /panel
```

## Limitaciones

- Barrio y dirección vienen de OpenStreetMap; en algunos sectores no hay datos y se completan a mano.
- El borrador automático guarda solo el texto en el teléfono hasta enviar o descartar.
