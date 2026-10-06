/*
 * Compartir la encuesta: código QR (con el escudo al centro), WhatsApp, copiar enlace
 * y afiche descargable para imprimir. Requiere /qrcode.js y /dialogo.js.
 *
 *   abrirCompartir()
 */
(function () {
    "use strict";

    const URL_ENCUESTA = location.origin + "/";
    const TITULO = "Caracterización de Zonas de Expendios";
    const UNIDAD = "Policía Metropolitana de Bucaramanga · MEBUC";

    const css = `
.cmp-fondo{ position:fixed; inset:0; z-index:900; background:rgba(6,25,16,.55); display:flex; align-items:center; justify-content:center; padding:16px; }
.cmp{
    width:min(380px,100%); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 20px 50px rgba(0,0,0,.3);
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; color:#14211a; max-height:calc(100vh - 32px); overflow-y:auto;
}
.cmp-cab{ position:relative; background:linear-gradient(120deg,#06341f,#0d5c37 70%,#127a47); color:#fff; padding:14px 16px; display:flex; align-items:center; gap:10px; }
.cmp-cab::after{ content:""; position:absolute; left:0; right:0; bottom:0; height:4px; background:linear-gradient(90deg,#fcd116 0 50%,#003893 50% 75%,#ce1126 75% 100%); }
.cmp-cab img{ width:38px; height:38px; border-radius:50%; background:#fff; box-shadow:0 0 0 2px #c8a24a; }
.cmp-cab b{ display:block; font-size:15px; }
.cmp-cab span{ font-size:12px; color:#cfe6d9; }
.cmp-cerrar{ margin-left:auto; background:rgba(255,255,255,.14); color:#fff; border:1px solid rgba(255,255,255,.35); border-radius:8px; width:36px; height:36px; font-size:16px; cursor:pointer; }
.cmp-cuerpo{ padding:16px; text-align:center; }
.cmp-qr{ display:inline-block; padding:10px; border:1px solid #d6e0da; border-radius:12px; background:#fff; }
.cmp-qr canvas{ display:block; width:230px; height:230px; }
.cmp-ayuda{ font-size:13px; color:#5d6b64; margin:10px 0 8px; }
.cmp-url{ font-family:ui-monospace,Consolas,monospace; font-size:12px; background:#f3f8f5; border:1px solid #d6e0da; border-radius:8px; padding:8px; word-break:break-all; color:#0a4a2c; }
.cmp-botones{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px; }
.cmp-botones button{
    display:flex; align-items:center; justify-content:center; gap:6px; min-height:44px; border-radius:9px;
    font:700 13.5px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; cursor:pointer; border:1px solid #d6e0da; background:#fff; color:#0a4a2c;
}
.cmp-botones button:hover{ background:#f3f8f5; }
.cmp-botones .cmp-wa{ background:#1f8f4e; border-color:#1f8f4e; color:#fff; }
.cmp-botones .cmp-wa:hover{ background:#187a42; }
.cmp-botones .cmp-ancho{ grid-column:1 / -1; background:#0d5c37; border-color:#0d5c37; color:#fff; }
.cmp-botones .cmp-ancho:hover{ background:#0a4a2c; }
.cmp-nota{ font-size:11.5px; color:#9a6700; background:#fbf4df; border:1px solid #ead9a6; border-radius:8px; padding:7px 9px; margin-top:12px; text-align:left; }
.cmp-ok{ font-size:12.5px; color:#127a47; font-weight:700; min-height:16px; margin-top:8px; }
@media (max-width:520px){ .cmp-fondo{ align-items:flex-end; padding:0; } .cmp{ width:100%; border-radius:18px 18px 0 0; } }`;
    const estilo = document.createElement("style");
    estilo.textContent = css;
    document.head.appendChild(estilo);

    let logo = null;
    function cargarLogo() {
        if (logo) return Promise.resolve(logo);
        return new Promise(ok => {
            const img = new Image();
            img.onload = () => { logo = img; ok(img); };
            img.onerror = () => ok(null);
            img.src = "/logo.png";
        });
    }

    /* Dibuja el QR (corrección de errores alta) con el escudo al centro */
    async function dibujarQR(canvas, lado, texto) {
        const qr = qrcode(0, "H");
        qr.addData(texto);
        qr.make();
        const n = qr.getModuleCount();
        const margen = 4;
        const celda = Math.floor(lado / (n + margen * 2));
        const tam = celda * (n + margen * 2);
        canvas.width = tam; canvas.height = tam;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, tam, tam);
        ctx.fillStyle = "#06341f";
        for (let f = 0; f < n; f++)
            for (let c = 0; c < n; c++)
                if (qr.isDark(f, c)) ctx.fillRect((c + margen) * celda, (f + margen) * celda, celda, celda);
        const img = await cargarLogo();
        if (img) {
            const l = Math.round(tam * 0.22), x = (tam - l) / 2;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(tam / 2, tam / 2, l / 2 + celda * 0.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.drawImage(img, x, x, l, l);
        }
        return canvas;
    }

    /* Afiche para imprimir o enviar como imagen (1080 x 1350) */
    async function crearAfiche() {
        const W = 1080, H = 1350;
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const x = c.getContext("2d");
        x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H);

        const g = x.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, "#06341f"); g.addColorStop(.7, "#0d5c37"); g.addColorStop(1, "#127a47");
        x.fillStyle = g; x.fillRect(0, 0, W, 250);
        [["#fcd116", 0, .5], ["#003893", .5, .75], ["#ce1126", .75, 1]].forEach(([col, a, b]) => {
            x.fillStyle = col; x.fillRect(W * a, 250, W * (b - a), 14);
        });

        const img = await cargarLogo();
        if (img) {
            x.fillStyle = "#fff"; x.beginPath(); x.arc(140, 125, 92, 0, Math.PI * 2); x.fill();
            x.strokeStyle = "#c8a24a"; x.lineWidth = 6; x.stroke();
            x.drawImage(img, 56, 41, 168, 168);
        }
        x.fillStyle = "#fff";
        x.font = "800 50px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        x.fillText("Caracterización de", 260, 112);
        x.fillText("Zonas de Expendios", 260, 170);
        x.fillStyle = "#cfe6d9";
        x.font = "600 28px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        x.fillText(UNIDAD, 260, 215);

        x.textAlign = "center";
        x.fillStyle = "#0a4a2c";
        x.font = "800 46px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        x.fillText("Escanee para diligenciar la encuesta", W / 2, 355);

        const q = await dibujarQR(document.createElement("canvas"), 700, URL_ENCUESTA);
        const lado = q.width, qx = (W - lado) / 2, qy = 400;
        x.fillStyle = "#f3f8f5";
        x.fillRect(qx - 24, qy - 24, lado + 48, lado + 48);
        x.strokeStyle = "#c8a24a"; x.lineWidth = 4;
        x.strokeRect(qx - 24, qy - 24, lado + 48, lado + 48);
        x.drawImage(q, qx, qy);

        x.fillStyle = "#14211a";
        x.font = "600 30px ui-monospace, Consolas, monospace";
        x.fillText(URL_ENCUESTA.replace(/^https?:\/\//, "").replace(/\/$/, ""), W / 2, qy + lado + 80);

        x.fillStyle = "#9a6700";
        x.font = "700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        x.fillText("Uso exclusivo del personal autorizado · No publicar", W / 2, qy + lado + 130);

        x.fillStyle = "#eef2ef"; x.fillRect(0, H - 90, W, 90);
        x.fillStyle = "#0a4a2c";
        x.font = "700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        x.fillText("Policía Nacional de Colombia", W / 2, H - 52);
        x.fillStyle = "#5d6b64";
        x.font = "500 20px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
        x.fillText("Desarrollado por ING. Santiago Escorcia", W / 2, H - 22);

        return await new Promise(ok => c.toBlob(ok, "image/png"));
    }

    function descargar(blob, nombre) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }

    async function abrirCompartir() {
        const fondo = document.createElement("div");
        fondo.className = "cmp-fondo";
        fondo.innerHTML = `
            <div class="cmp" role="dialog" aria-modal="true" aria-labelledby="cmpTitulo">
                <div class="cmp-cab">
                    <img src="/logo.png" alt="">
                    <div><b id="cmpTitulo">Compartir encuesta</b><span>Escanee el código o envíe el enlace</span></div>
                    <button type="button" class="cmp-cerrar" aria-label="Cerrar">✕</button>
                </div>
                <div class="cmp-cuerpo">
                    <div class="cmp-qr"><canvas aria-label="Código QR de la encuesta"></canvas></div>
                    <p class="cmp-ayuda">Apunte la cámara del celular al código para abrir la encuesta.</p>
                    <div class="cmp-url"></div>
                    <div class="cmp-botones">
                        <button type="button" class="cmp-wa">WhatsApp</button>
                        <button type="button" class="cmp-copiar">📋 Copiar enlace</button>
                        <button type="button" class="cmp-compartir" hidden>📤 Compartir...</button>
                        <button type="button" class="cmp-imagen">🖼️ Enviar QR como imagen</button>
                        <button type="button" class="cmp-afiche cmp-ancho">⬇ Descargar QR para imprimir</button>
                    </div>
                    <div class="cmp-ok" aria-live="polite"></div>
                    <div class="cmp-nota">🔒 Comparta el QR solo con funcionarios autorizados. No lo publique en redes ni grupos abiertos.</div>
                </div>
            </div>`;
        document.body.appendChild(fondo);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const $c = sel => fondo.querySelector(sel);
        $c(".cmp-url").textContent = URL_ENCUESTA;
        await dibujarQR($c("canvas"), 460, URL_ENCUESTA);

        const ok = t => { $c(".cmp-ok").textContent = t; setTimeout(() => { $c(".cmp-ok").textContent = ""; }, 3000); };
        const mensaje = `Encuesta de ${TITULO} (MEBUC). Diligénciela aquí: ${URL_ENCUESTA}`;

        function cerrar() {
            document.removeEventListener("keydown", tecla);
            document.body.style.overflow = prevOverflow;
            fondo.remove();
        }
        function tecla(e) { if (e.key === "Escape") cerrar(); }
        document.addEventListener("keydown", tecla);
        $c(".cmp-cerrar").addEventListener("click", cerrar);
        fondo.addEventListener("click", e => { if (e.target === fondo) cerrar(); });

        $c(".cmp-wa").addEventListener("click", () => {
            window.open("https://wa.me/?text=" + encodeURIComponent(mensaje), "_blank", "noopener");
        });

        $c(".cmp-copiar").addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(URL_ENCUESTA); ok("✓ Enlace copiado"); }
            catch (_) {
                const t = document.createElement("textarea"); t.value = URL_ENCUESTA; document.body.appendChild(t);
                t.select(); document.execCommand("copy"); t.remove(); ok("✓ Enlace copiado");
            }
        });

        if (navigator.share) {
            $c(".cmp-compartir").hidden = false;
            $c(".cmp-compartir").addEventListener("click", () => {
                navigator.share({ title: TITULO, text: mensaje, url: URL_ENCUESTA }).catch(() => {});
            });
        }

        $c(".cmp-imagen").addEventListener("click", async () => {
            const blob = await crearAfiche();
            const archivo = new File([blob], "QR_Encuesta_MEBUC.png", { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
                navigator.share({ files: [archivo], title: TITULO, text: mensaje }).catch(() => {});
            } else {
                descargar(blob, "QR_Encuesta_MEBUC.png");
                ok("✓ Imagen descargada; adjúntela en el chat");
            }
        });

        $c(".cmp-afiche").addEventListener("click", async () => {
            descargar(await crearAfiche(), "QR_Encuesta_MEBUC.png");
            ok("✓ QR descargado");
        });

        setTimeout(() => $c(".cmp-cerrar").focus(), 30);
    }

    window.abrirCompartir = abrirCompartir;
    window.crearAficheQR = crearAfiche;
})();
