/**
 * Worker de Caracterización de Zonas de Expendios - MEBUC
 *
 * Rutas:
 *   POST   /api/caracterizaciones                       guarda los datos de un registro (JSON, abierto)
 *                                                        y devuelve un permiso temporal para subir sus fotos
 *   PUT    /api/caracterizaciones/:id/fotos/:tipo/:n    sube UNA foto original (sin límite de calidad);
 *                                                        con ?mini=1 sube su miniatura para el panel y el Excel
 *   GET    /api/verificar                               comprueba la clave del panel (Authorization: Bearer ADMIN_KEY)
 *   GET    /api/registros                               lista registros con enlaces firmados a las fotos (admin)
 *   DELETE /api/registros/:id                           elimina un registro y sus fotos (admin)
 *   GET    /api/fotos/<clave>?exp=&sig=[&dl=1]          descarga una foto con enlace firmado
 *   Cualquier otra ruta se sirve desde /public (formulario y panel).
 */

const TIPOS = ["actor", "cedula", "marquilla", "punto"];
const MUNICIPIOS = ["Bucaramanga", "Floridablanca", "Girón", "Piedecuesta", "Lebrija", "Los Santos"];
const TIPOS_EXPENDIO = ["Móvil", "Fijo"];
const GRADOS = {
    GR: "General", MG: "Mayor General", BG: "Brigadier General", CR: "Coronel", TC: "Teniente Coronel",
    MY: "Mayor", CT: "Capitán", TE: "Teniente", ST: "Subteniente",
    CM: "Comisario", SC: "Subcomisario", IJ: "Intendente Jefe", IT: "Intendente", SI: "Subintendente", PT: "Patrullero",
    PP: "Patrullero de Policía",
    SM: "Sargento Mayor", SP: "Sargento Primero", SV: "Sargento Viceprimero", SS: "Sargento Segundo",
    CP: "Cabo Primero", CS: "Cabo Segundo",
    AG: "Agente", AUX: "Auxiliar de Policía", NU: "Personal no uniformado"
};
const MAX_FUNCIONARIOS = 10;
const HORAS_PERMISO_SUBIDA = 72;
const EXT_CONOCIDAS = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp", heic: "heic", heif: "heif", gif: "gif", avif: "avif", tiff: "tif", bmp: "bmp" };

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/api/")) {
            return env.ASSETS.fetch(request);
        }
        try {
            return await enrutar(request, env, url);
        } catch (err) {
            console.error(err);
            return json({ error: "Error interno del servidor: " + (err && err.message ? err.message : "desconocido") }, 500);
        }
    }
};

/* Agrega columnas nuevas a bases de datos creadas con una versión anterior (solo una vez) */
let esquemaListo = false;
async function asegurarEsquema(env) {
    if (esquemaListo) return;
    for (const sql of [
        "ALTER TABLE registros ADD COLUMN zap TEXT",
        "ALTER TABLE registros ADD COLUMN funcionarios_json TEXT",
        "ALTER TABLE fotos ADD COLUMN mini_key TEXT",
        "ALTER TABLE registros ADD COLUMN correo_registra TEXT",
        "ALTER TABLE registros ADD COLUMN nombre_registra TEXT",
        "ALTER TABLE registros ADD COLUMN sustancias_json TEXT",
        "ALTER TABLE registros ADD COLUMN estructuras_json TEXT",
        "ALTER TABLE registros ADD COLUMN actores_json TEXT"
    ]) {
        try {
            await env.DB.prepare(sql).run();
        } catch (err) {
            if (!/duplicate column/i.test(String(err && err.message))) throw err;
        }
    }
    // La tabla fotos se creó con CHECK (tipo IN ('actor','marquilla','punto')): se rehace para aceptar "cedula"
    const def = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'fotos'").first();
    if (def && def.sql && !def.sql.includes("cedula")) {
        await env.DB.batch([
            env.DB.prepare(`CREATE TABLE fotos_nueva (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                registro_id TEXT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
                tipo TEXT NOT NULL CHECK (tipo IN ('actor','cedula','marquilla','punto')),
                orden INTEGER NOT NULL,
                r2_key TEXT NOT NULL UNIQUE,
                tamano INTEGER,
                content_type TEXT,
                mini_key TEXT)`),
            env.DB.prepare(`INSERT INTO fotos_nueva (id, registro_id, tipo, orden, r2_key, tamano, content_type, mini_key)
                            SELECT id, registro_id, tipo, orden, r2_key, tamano, content_type, mini_key FROM fotos`),
            env.DB.prepare("DROP TABLE fotos"),
            env.DB.prepare("ALTER TABLE fotos_nueva RENAME TO fotos"),
            env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_fotos_registro ON fotos(registro_id)")
        ]);
    }
    esquemaListo = true;
}

async function enrutar(request, env, url) {
    const { pathname } = url;
    const metodo = request.method;

    if (pathname.startsWith("/api/fotos/") && metodo === "GET") return servirFoto(env, url);

    await asegurarEsquema(env);

    if (pathname === "/api/caracterizaciones" && metodo === "POST") return crearRegistro(request, env, url);

    const subida = pathname.match(/^\/api\/caracterizaciones\/([A-Za-z0-9-]{8,64})\/fotos\/(actor|cedula|marquilla|punto)\/(\d{1,3})$/);
    if (subida && metodo === "PUT") return subirFoto(request, env, url, subida[1], subida[2], Number(subida[3]));

    if (pathname === "/api/verificar" && metodo === "GET") {
        const fallo = verificarAdmin(request, env);
        return fallo || json({ ok: true });
    }

    if (pathname === "/api/registros" && metodo === "GET") {
        const fallo = verificarAdmin(request, env);
        return fallo || listarRegistros(env, url);
    }

    const borrar = pathname.match(/^\/api\/registros\/([A-Za-z0-9-]{8,64})$/);
    if (borrar && metodo === "DELETE") {
        const fallo = verificarAdmin(request, env);
        return fallo || eliminarRegistro(env, borrar[1]);
    }

    return json({ error: "Ruta no encontrada" }, 404);
}

/* ============================
   AUTENTICACIÓN Y FIRMAS
============================ */
const enc = new TextEncoder();

function iguales(a, b) {
    const x = enc.encode(a || "");
    const y = enc.encode(b || "");
    if (x.byteLength !== y.byteLength || x.byteLength === 0) return false;
    return crypto.subtle.timingSafeEqual(x, y);
}

function verificarAdmin(request, env) {
    if (!env.ADMIN_KEY) return json({ error: "Falta configurar ADMIN_KEY en el servidor" }, 500);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!iguales(token, env.ADMIN_KEY)) return json({ error: "Clave de administrador inválida" }, 401);
    return null;
}

let claveHmacCache = null;
async function claveHmac(env) {
    if (!env.SIGNING_SECRET) throw new Error("Falta configurar SIGNING_SECRET en el servidor");
    if (claveHmacCache && claveHmacCache.secreto === env.SIGNING_SECRET) return claveHmacCache.clave;
    const clave = await crypto.subtle.importKey(
        "raw", enc.encode(env.SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    claveHmacCache = { secreto: env.SIGNING_SECRET, clave };
    return clave;
}

async function firmar(env, contenido) {
    const firma = await crypto.subtle.sign("HMAC", await claveHmac(env), enc.encode(contenido));
    return btoa(String.fromCharCode(...new Uint8Array(firma)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const firmaFoto = (env, r2Key, exp) => firmar(env, `${r2Key}:${exp}`);
const firmaSubida = (env, id, exp) => firmar(env, `subir:${id}:${exp}`);

async function permisoSubida(env, id) {
    const exp = Math.floor(Date.now() / 1000) + HORAS_PERMISO_SUBIDA * 3600;
    return { exp, token: await firmaSubida(env, id, exp) };
}

/* ============================
   CREAR REGISTRO (solo datos)
============================ */
function texto(v, max = 2000) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function crearRegistro(request, env, url) {
    // El formulario es abierto (sin código). Solo se aceptan envíos desde la propia página.
    const origen = request.headers.get("Origin");
    if (origen && origen !== url.origin) return json({ error: "Origen no permitido" }, 403);

    let d;
    try {
        const tipo = request.headers.get("Content-Type") || "";
        if (tipo.includes("application/json")) d = await request.json();
        else if (tipo.includes("multipart/form-data")) d = JSON.parse((await request.formData()).get("datos"));
        else return json({ error: "Formato de envío no válido" }, 415);
    } catch {
        return json({ error: "Datos del formulario no válidos" }, 400);
    }

    // Campo trampa: las personas no lo ven; si viene lleno es un robot. Se responde "ok" sin guardar.
    if (typeof d.sitio_web === "string" && d.sitio_web.trim() !== "") {
        return json({ ok: true, id: texto(d.id_registro, 64) }, 201);
    }

    const registro = {
        id: texto(d.id_registro, 64),
        fecha_registro: texto(d.fecha_registro, 40) || new Date().toISOString(),
        recibido_en: new Date().toISOString(),
        municipio: texto(d.municipio, 60),
        barrio: texto(d.barrio, 120),
        direccion: texto(d.direccion, 200),
        direccion_gps: texto(d.direccion_gps, 300),
        latitud: d.latitud === null || d.latitud === "" ? NaN : Number(d.latitud),
        longitud: d.longitud === null || d.longitud === "" ? NaN : Number(d.longitud),
        precision_m: Number.isFinite(Number(d.precision_m)) && d.precision_m !== null ? Math.round(Number(d.precision_m)) : null,
        coordenadas: texto(d.coordenadas, 60),
        tipo_expendio: texto(d.tipo_expendio, 20),
        actor: texto(d.actor),
        sustancia: texto(d.sustancia),
        sustancias_json: "[]",
        estructuras_json: "[]",
        actores_json: "[]",
        correo_registra: texto(d.correo_registra, 120).toLowerCase(),
        nombre_registra: texto(d.nombre_registra, 120),
        venezolanos: ["SI", "NO"].includes(d.venezolanos) ? d.venezolanos : "",
        marquillas: texto(d.marquillas),
        funcionarios: "",
        zap: "",
        funcionarios_json: "[]"
    };

    // Funcionarios: [{ zap, sigla, nombre }]
    const lista = Array.isArray(d.funcionarios_lista) ? d.funcionarios_lista.slice(0, MAX_FUNCIONARIOS) : [];
    const funcionarios = lista.map(f => ({
        zap: texto(f && f.zap, 20).toUpperCase(),
        sigla: texto(f && f.sigla, 5).toUpperCase(),
        nombre: texto(f && f.nombre, 120)
    })).map(f => ({ ...f, grado: GRADOS[f.sigla] || "" }));
    const funcionariosOk = funcionarios.length > 0 && funcionarios.every(f => f.zap && f.grado && f.nombre);
    if (funcionariosOk) {
        registro.funcionarios = funcionarios.map(f => `ZAP ${f.zap} · ${f.sigla} ${f.nombre}`).join("\n");
        registro.zap = [...new Set(funcionarios.map(f => f.zap))].join(", ");
        registro.funcionarios_json = JSON.stringify(funcionarios);
    }

    // Sustancias: [{ id, nombre, otra, valor }]
    if (Array.isArray(d.sustancias_lista)) {
        const sustancias = d.sustancias_lista.slice(0, 30).map(x => {
            const valor = Number(x && x.valor);
            return {
                id: texto(x && x.id, 20),
                nombre: texto(x && x.nombre, 80),
                otra: texto(x && x.otra, 80),
                valor: Number.isFinite(valor) && valor > 0 ? Math.round(valor) : null
            };
        }).filter(x => x.id && x.nombre);
        registro.sustancias_json = JSON.stringify(sustancias);
        if (!sustancias.length || sustancias.some(x => !x.valor)) registro.sustanciaIncompleta = true;
        registro.sustancia = sustancias
            .map(x => x.nombre + (x.valor ? ` ($${x.valor.toLocaleString("es-CO")})` : ""))
            .join(" · ");
    }

    // Estructuras: [{ id, nombre, otra }]
    const estructuras = (Array.isArray(d.estructuras_lista) ? d.estructuras_lista : []).slice(0, 20).map(x => ({
        id: texto(x && x.id, 20), nombre: texto(x && x.nombre, 80), otra: texto(x && x.otra, 80)
    })).filter(x => x.id && x.nombre && (x.id !== "otra" || x.otra));
    // Actores: [{ alias, foto, cedula }]  (la foto n corresponde al actor n)
    const actores = (Array.isArray(d.actores_lista) ? d.actores_lista : []).slice(0, 15).map(x => ({
        alias: texto(x && x.alias, 120), foto: !!(x && x.foto), cedula: !!(x && x.cedula)
    }));
    registro.estructuras_json = JSON.stringify(estructuras);
    registro.actores_json = JSON.stringify(actores);
    const textoEstructuras = estructuras.map(x => x.nombre).join(", ");
    const textoActores = actores.map(x => x.alias).filter(Boolean).join(", ");
    if (textoEstructuras || textoActores) {
        registro.actor = [textoEstructuras && `Estructura: ${textoEstructuras}`, textoActores && `Actores: ${textoActores}`].filter(Boolean).join(" · ");
    }

    const errores = [];
    if (!estructuras.length) errores.push("estructura");
    if (!actores.length || actores.some(a => !a.alias)) errores.push("actor reconocido (nombre o alias)");
    if (!registro.venezolanos) errores.push("vinculación de venezolanos");
    if (!registro.marquillas) errores.push("marquillas");
    if (!/^[a-z0-9._%+-]+@correo\.policia\.gov\.co$/.test(registro.correo_registra)) errores.push("correo institucional (@correo.policia.gov.co)");
    if (!Array.isArray(d.sustancias_lista) || registro.sustanciaIncompleta) errores.push("sustancias y valor de la dosis");
    if (registro.nombre_registra.split(/\s+/).filter(Boolean).length < 2) errores.push("nombre completo");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(registro.id)) errores.push("identificador");
    if (!MUNICIPIOS.includes(registro.municipio)) errores.push("municipio");
    if (!registro.barrio) errores.push("barrio");
    if (!registro.direccion) errores.push("dirección");
    if (!Number.isFinite(registro.latitud) || Math.abs(registro.latitud) > 90 ||
        !Number.isFinite(registro.longitud) || Math.abs(registro.longitud) > 180) errores.push("coordenadas");
    if (!TIPOS_EXPENDIO.includes(registro.tipo_expendio)) errores.push("tipo de expendio");
    if (!funcionariosOk) errores.push("funcionarios (código ZAP, grado y nombre)");
    if (errores.length) return json({ error: "Campos inválidos: " + errores.join(", ") }, 400);

    // Si el registro ya existe (reintento tras corte de red), no se duplica
    const existe = await env.DB.prepare("SELECT id FROM registros WHERE id = ?").bind(registro.id).first();
    if (!existe) {
        await env.DB.prepare(`INSERT INTO registros
            (id, fecha_registro, recibido_en, municipio, barrio, direccion, direccion_gps,
             latitud, longitud, precision_m, coordenadas, tipo_expendio, actor, sustancia,
             venezolanos, marquillas, funcionarios, zap, funcionarios_json,
             correo_registra, nombre_registra, sustancias_json, estructuras_json, actores_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
            registro.id, registro.fecha_registro, registro.recibido_en, registro.municipio,
            registro.barrio, registro.direccion, registro.direccion_gps,
            registro.latitud, registro.longitud, registro.precision_m, registro.coordenadas,
            registro.tipo_expendio, registro.actor, registro.sustancia, registro.venezolanos,
            registro.marquillas, registro.funcionarios, registro.zap, registro.funcionarios_json,
            registro.correo_registra, registro.nombre_registra, registro.sustancias_json,
            registro.estructuras_json, registro.actores_json
        ).run();
    }

    return json({ ok: true, id: registro.id, duplicado: !!existe, subida: await permisoSubida(env, registro.id) }, existe ? 200 : 201);
}

/* ============================
   SUBIR UNA FOTO (original o miniatura), directo a R2 sin pasar por memoria
============================ */
function extension(tipoContenido) {
    const sub = (tipoContenido.split("/")[1] || "").split(";")[0].trim().toLowerCase().replace(/^x-/, "");
    return EXT_CONOCIDAS[sub] || sub.replace(/[^a-z0-9]/g, "").slice(0, 5) || "img";
}

async function subirFoto(request, env, url, id, tipo, orden) {
    const exp = Number(request.headers.get("X-Exp"));
    const token = request.headers.get("X-Token") || "";
    if (!exp || exp < Math.floor(Date.now() / 1000) || !iguales(token, await firmaSubida(env, id, exp))) {
        return json({ error: "Permiso de subida no válido o vencido. Guarde de nuevo el registro." }, 403);
    }
    if (orden < 1) return json({ error: "Número de foto no válido" }, 400);

    const tipoContenido = (request.headers.get("Content-Type") || "").toLowerCase();
    if (!tipoContenido.startsWith("image/")) return json({ error: "El archivo no es una imagen" }, 415);
    if (!request.body) return json({ error: "La fotografía llegó vacía" }, 400);

    const existe = await env.DB.prepare("SELECT id FROM registros WHERE id = ?").bind(id).first();
    if (!existe) return json({ error: "El registro no existe" }, 404);

    const esMini = url.searchParams.get("mini") === "1";
    const key = esMini ? `${id}/${tipo}_${orden}_mini.jpg` : `${id}/${tipo}_${orden}.${extension(tipoContenido)}`;

    // Se guarda tal cual llega: sin recomprimir ni reducir
    const objeto = await env.FOTOS.put(key, request.body, { httpMetadata: { contentType: tipoContenido } });

    if (esMini) {
        const r = await env.DB.prepare("UPDATE fotos SET mini_key = ? WHERE registro_id = ? AND tipo = ? AND orden = ?")
            .bind(key, id, tipo, orden).run();
        if (!r.meta || r.meta.changes === 0) {
            await env.FOTOS.delete(key);
            return json({ error: "Suba primero la fotografía original" }, 409);
        }
    } else {
        // Si ya había una foto en esa posición con otro formato, se reemplaza
        const { results: previas } = await env.DB.prepare(
            "SELECT r2_key, mini_key FROM fotos WHERE registro_id = ? AND tipo = ? AND orden = ? AND r2_key <> ?"
        ).bind(id, tipo, orden, key).all();
        if (previas.length) {
            await env.FOTOS.delete(previas.flatMap(p => [p.r2_key, p.mini_key].filter(Boolean)));
            await env.DB.prepare("DELETE FROM fotos WHERE registro_id = ? AND tipo = ? AND orden = ? AND r2_key <> ?")
                .bind(id, tipo, orden, key).run();
        }
        await env.DB.prepare(`INSERT INTO fotos (registro_id, tipo, orden, r2_key, tamano, content_type)
                              VALUES (?,?,?,?,?,?)
                              ON CONFLICT(r2_key) DO UPDATE SET tamano = excluded.tamano, content_type = excluded.content_type`)
            .bind(id, tipo, orden, key, objeto ? objeto.size : null, tipoContenido).run();
    }

    return json({ ok: true, key, tamano: objeto ? objeto.size : null }, 201);
}

/* ============================
   LISTAR REGISTROS (PANEL / EXCEL)
============================ */
async function listarRegistros(env, url) {
    const { results: registros } = await env.DB.prepare(
        "SELECT * FROM registros ORDER BY recibido_en DESC LIMIT 20000"
    ).all();
    const { results: fotos } = await env.DB.prepare(
        "SELECT registro_id, tipo, orden, r2_key, mini_key, tamano, content_type FROM fotos ORDER BY registro_id, tipo, orden"
    ).all();

    const dias = Math.max(1, Math.min(365, Number(env.LINK_DIAS) || 30));
    const exp = Math.floor(Date.now() / 1000) + dias * 86400;
    const base = url.origin;
    const enlace = async key => `${base}/api/fotos/${key}?exp=${exp}&sig=${await firmaFoto(env, key, exp)}`;

    const porRegistro = new Map();
    for (const f of fotos) {
        const ver = await enlace(f.r2_key);
        const item = {
            tipo: f.tipo, orden: f.orden, tamano: f.tamano, formato: f.content_type,
            ver, descargar: ver + "&dl=1",
            mini: f.mini_key ? await enlace(f.mini_key) : null
        };
        if (!porRegistro.has(f.registro_id)) porRegistro.set(f.registro_id, []);
        porRegistro.get(f.registro_id).push(item);
    }

    const datos = registros.map(r => {
        const lista = porRegistro.get(r.id) || [];
        const agrupadas = {};
        for (const t of TIPOS) agrupadas[t] = lista.filter(f => f.tipo === t);
        let funcionariosLista = [];
        try { funcionariosLista = JSON.parse(r.funcionarios_json || "[]"); } catch { /* registro antiguo */ }
        let sustanciasLista = [];
        try { sustanciasLista = JSON.parse(r.sustancias_json || "[]"); } catch { /* registro antiguo */ }
        const leerJSON = t => { try { return JSON.parse(t || "[]"); } catch { return []; } };
        const { funcionarios_json, sustancias_json, estructuras_json, actores_json, ...resto } = r;
        return { ...resto, funcionarios_lista: funcionariosLista, sustancias_lista: sustanciasLista,
                 estructuras_lista: leerJSON(estructuras_json), actores_lista: leerJSON(actores_json), fotos: agrupadas };
    });

    return json({
        generado: new Date().toISOString(),
        enlaces_expiran: new Date(exp * 1000).toISOString(),
        total: datos.length,
        registros: datos
    });
}

/* ============================
   ELIMINAR REGISTRO
============================ */
async function eliminarRegistro(env, id) {
    const existe = await env.DB.prepare("SELECT id FROM registros WHERE id = ?").bind(id).first();
    if (!existe) return json({ error: "Registro no encontrado" }, 404);
    const { results } = await env.DB.prepare("SELECT r2_key, mini_key FROM fotos WHERE registro_id = ?").bind(id).all();

    await env.DB.batch([
        env.DB.prepare("DELETE FROM fotos WHERE registro_id = ?").bind(id),
        env.DB.prepare("DELETE FROM registros WHERE id = ?").bind(id)
    ]);
    const claves = results.flatMap(r => [r.r2_key, r.mini_key].filter(Boolean));
    for (let i = 0; i < claves.length; i += 1000) await env.FOTOS.delete(claves.slice(i, i + 1000));
    return json({ ok: true });
}

/* ============================
   DESCARGAR FOTO
============================ */
async function servirFoto(env, url) {
    const r2Key = decodeURIComponent(url.pathname.slice("/api/fotos/".length));
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") || "";

    if (!/^[A-Za-z0-9-]{8,64}\/(actor|cedula|marquilla|punto)_\d{1,3}(_mini)?\.[a-z0-9]{2,5}$/.test(r2Key)) {
        return mensaje("Enlace no válido.", 400);
    }
    if (!exp || exp < Math.floor(Date.now() / 1000)) {
        return mensaje("Este enlace expiró. Descargue un Excel nuevo desde el panel de registros.", 403);
    }
    if (!iguales(sig, await firmaFoto(env, r2Key, exp))) {
        return mensaje("Enlace no válido.", 403);
    }

    const objeto = await env.FOTOS.get(r2Key);
    if (!objeto) return mensaje("La fotografía ya no existe.", 404);

    const nombre = "MEBUC_" + r2Key.replace("/", "_");
    const descargar = url.searchParams.get("dl") === "1";
    return new Response(objeto.body, {
        headers: {
            "Content-Type": objeto.httpMetadata?.contentType || "application/octet-stream",
            "Content-Length": String(objeto.size),
            "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename="${nombre}"`,
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer"
        }
    });
}

/* ============================
   RESPUESTAS
============================ */
function json(cuerpo, estado = 200) {
    return new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
        }
    });
}

function mensaje(texto, estado) {
    return new Response(texto, {
        status: estado,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
}
