/**
 * Worker de Caracterización de Zonas de Expendios - MEBUC
 *
 * Rutas:
 *   POST   /api/caracterizaciones   guarda un registro + fotos   (abierto, sin código)
 *   GET    /api/verificar           comprueba la clave del panel (Authorization: Bearer ADMIN_KEY)
 *   GET    /api/registros           lista registros con enlaces firmados a las fotos (admin)
 *   DELETE /api/registros/:id       elimina un registro y sus fotos (admin)
 *   GET    /api/fotos/<clave>?exp=&sig=[&dl=1]   descarga una foto con enlace firmado
 *   Cualquier otra ruta se sirve desde /public (formulario y panel).
 */

const TIPOS = ["actor", "marquilla", "punto"];
const MUNICIPIOS = ["Bucaramanga", "Floridablanca", "Girón", "Piedecuesta", "Lebrija", "Los Santos"];
const TIPOS_EXPENDIO = ["Móvil", "Fijo"];
const MAX_FOTOS_TIPO = 6;
const MAX_BYTES_FOTO = 8 * 1024 * 1024;
const EXTENSIONES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

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
            return json({ error: "Error interno del servidor" }, 500);
        }
    }
};

async function enrutar(request, env, url) {
    const { pathname } = url;
    const metodo = request.method;

    if (pathname === "/api/caracterizaciones" && metodo === "POST") return crearRegistro(request, env, url);

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

    if (pathname.startsWith("/api/fotos/") && metodo === "GET") return servirFoto(env, url);

    return json({ error: "Ruta no encontrada" }, 404);
}

/* ============================
   AUTENTICACIÓN
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

/* ============================
   ENLACES FIRMADOS PARA FOTOS
============================ */
let claveHmacCache = null;

async function claveHmac(env) {
    if (!env.SIGNING_SECRET) throw new Error("Falta configurar SIGNING_SECRET");
    if (claveHmacCache && claveHmacCache.secreto === env.SIGNING_SECRET) return claveHmacCache.clave;
    const clave = await crypto.subtle.importKey(
        "raw", enc.encode(env.SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    claveHmacCache = { secreto: env.SIGNING_SECRET, clave };
    return clave;
}

async function firmar(env, r2Key, exp) {
    const firma = await crypto.subtle.sign("HMAC", await claveHmac(env), enc.encode(`${r2Key}:${exp}`));
    return btoa(String.fromCharCode(...new Uint8Array(firma)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ============================
   CREAR REGISTRO
============================ */
function texto(v, max = 2000) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function crearRegistro(request, env, url) {
    // El formulario es abierto (sin código). Solo se aceptan envíos desde la propia página.
    const origen = request.headers.get("Origin");
    if (origen && origen !== url.origin) {
        return json({ error: "Origen no permitido" }, 403);
    }

    const tipoContenido = request.headers.get("Content-Type") || "";
    if (!tipoContenido.includes("multipart/form-data")) {
        return json({ error: "Formato de envío no válido" }, 415);
    }

    const fd = await request.formData();
    let d;
    try {
        d = JSON.parse(fd.get("datos"));
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
        venezolanos: ["SI", "NO"].includes(d.venezolanos) ? d.venezolanos : "",
        marquillas: texto(d.marquillas),
        funcionarios: texto(d.funcionarios)
    };

    const errores = [];
    if (!/^[A-Za-z0-9-]{8,64}$/.test(registro.id)) errores.push("identificador");
    if (!MUNICIPIOS.includes(registro.municipio)) errores.push("municipio");
    if (!registro.barrio) errores.push("barrio");
    if (!registro.direccion) errores.push("dirección");
    if (!Number.isFinite(registro.latitud) || Math.abs(registro.latitud) > 90 ||
        !Number.isFinite(registro.longitud) || Math.abs(registro.longitud) > 180) errores.push("coordenadas");
    if (!TIPOS_EXPENDIO.includes(registro.tipo_expendio)) errores.push("tipo de expendio");
    if (!registro.funcionarios) errores.push("ZAP y funcionarios");
    if (errores.length) return json({ error: "Campos inválidos: " + errores.join(", ") }, 400);

    // Si el registro ya existe (reintento tras corte de red), no se duplica
    const existe = await env.DB.prepare("SELECT id FROM registros WHERE id = ?").bind(registro.id).first();
    if (existe) return json({ ok: true, id: registro.id, duplicado: true });

    // Validar fotos
    const fotos = [];
    for (const tipo of TIPOS) {
        const archivos = fd.getAll(`fotos_${tipo}`).filter(f => f && typeof f === "object" && "arrayBuffer" in f);
        if (archivos.length > MAX_FOTOS_TIPO) {
            return json({ error: `Máximo ${MAX_FOTOS_TIPO} fotografías de ${tipo}` }, 400);
        }
        archivos.forEach((archivo, i) => {
            fotos.push({ tipo, orden: i + 1, archivo });
        });
    }
    for (const f of fotos) {
        if (!EXTENSIONES[f.archivo.type]) return json({ error: "Solo se aceptan imágenes JPG, PNG o WEBP" }, 400);
        if (f.archivo.size > MAX_BYTES_FOTO) return json({ error: "Una fotografía supera el tamaño máximo (8 MB)" }, 413);
    }

    // Subir fotos a R2
    const subidas = [];
    try {
        for (const f of fotos) {
            const key = `${registro.id}/${f.tipo}_${f.orden}.${EXTENSIONES[f.archivo.type]}`;
            await env.FOTOS.put(key, await f.archivo.arrayBuffer(), {
                httpMetadata: { contentType: f.archivo.type }
            });
            subidas.push({ ...f, key });
        }

        const sentencias = [
            env.DB.prepare(`INSERT INTO registros
                (id, fecha_registro, recibido_en, municipio, barrio, direccion, direccion_gps,
                 latitud, longitud, precision_m, coordenadas, tipo_expendio, actor, sustancia,
                 venezolanos, marquillas, funcionarios)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
                registro.id, registro.fecha_registro, registro.recibido_en, registro.municipio,
                registro.barrio, registro.direccion, registro.direccion_gps,
                registro.latitud, registro.longitud, registro.precision_m, registro.coordenadas,
                registro.tipo_expendio, registro.actor, registro.sustancia, registro.venezolanos,
                registro.marquillas, registro.funcionarios
            ),
            ...subidas.map(s => env.DB.prepare(
                "INSERT INTO fotos (registro_id, tipo, orden, r2_key, tamano, content_type) VALUES (?,?,?,?,?,?)"
            ).bind(registro.id, s.tipo, s.orden, s.key, s.archivo.size, s.archivo.type))
        ];
        await env.DB.batch(sentencias);
    } catch (err) {
        // Si algo falla, no dejar fotos huérfanas
        if (subidas.length) await env.FOTOS.delete(subidas.map(s => s.key)).catch(() => {});
        throw err;
    }

    return json({ ok: true, id: registro.id, fotos: subidas.length }, 201);
}

/* ============================
   LISTAR REGISTROS (PANEL / EXCEL)
============================ */
async function listarRegistros(env, url) {
    const { results: registros } = await env.DB.prepare(
        "SELECT * FROM registros ORDER BY recibido_en DESC LIMIT 20000"
    ).all();
    const { results: fotos } = await env.DB.prepare(
        "SELECT registro_id, tipo, orden, r2_key, tamano FROM fotos ORDER BY registro_id, tipo, orden"
    ).all();

    const dias = Math.max(1, Math.min(365, Number(env.LINK_DIAS) || 30));
    const exp = Math.floor(Date.now() / 1000) + dias * 86400;
    const base = url.origin;

    const porRegistro = new Map();
    for (const f of fotos) {
        const sig = await firmar(env, f.r2_key, exp);
        const enlace = `${base}/api/fotos/${f.r2_key}?exp=${exp}&sig=${sig}`;
        const item = { tipo: f.tipo, orden: f.orden, tamano: f.tamano, ver: enlace, descargar: enlace + "&dl=1" };
        if (!porRegistro.has(f.registro_id)) porRegistro.set(f.registro_id, []);
        porRegistro.get(f.registro_id).push(item);
    }

    const datos = registros.map(r => {
        const lista = porRegistro.get(r.id) || [];
        const agrupadas = {};
        for (const t of TIPOS) agrupadas[t] = lista.filter(f => f.tipo === t);
        return { ...r, fotos: agrupadas };
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
    const { results } = await env.DB.prepare("SELECT r2_key FROM fotos WHERE registro_id = ?").bind(id).all();
    const existe = await env.DB.prepare("SELECT id FROM registros WHERE id = ?").bind(id).first();
    if (!existe) return json({ error: "Registro no encontrado" }, 404);

    await env.DB.batch([
        env.DB.prepare("DELETE FROM fotos WHERE registro_id = ?").bind(id),
        env.DB.prepare("DELETE FROM registros WHERE id = ?").bind(id)
    ]);
    if (results.length) await env.FOTOS.delete(results.map(r => r.r2_key));
    return json({ ok: true });
}

/* ============================
   DESCARGAR FOTO
============================ */
async function servirFoto(env, url) {
    const r2Key = decodeURIComponent(url.pathname.slice("/api/fotos/".length));
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig") || "";

    if (!/^[A-Za-z0-9-]{8,64}\/(actor|marquilla|punto)_\d{1,2}\.(jpg|png|webp)$/.test(r2Key)) {
        return mensaje("Enlace no válido.", 400);
    }
    if (!exp || exp < Math.floor(Date.now() / 1000)) {
        return mensaje("Este enlace expiró. Descargue un Excel nuevo desde el panel de registros.", 403);
    }
    if (!iguales(sig, await firmar(env, r2Key, exp))) {
        return mensaje("Enlace no válido.", 403);
    }

    const objeto = await env.FOTOS.get(r2Key);
    if (!objeto) return mensaje("La fotografía ya no existe.", 404);

    const nombre = "MEBUC_" + r2Key.replace("/", "_");
    const descargar = url.searchParams.get("dl") === "1";
    return new Response(objeto.body, {
        headers: {
            "Content-Type": objeto.httpMetadata?.contentType || "image/jpeg",
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
