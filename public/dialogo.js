/*
 * Ventanas de aviso y confirmación con el diseño de la página
 * (reemplazan los alert() y confirm() del navegador).
 *
 *   await avisar("Mensaje", { titulo: "Atención" })
 *   if (await confirmar("¿Seguro?", { titulo: "Eliminar", aceptar: "Eliminar", tipo: "peligro" })) { ... }
 *
 * Opciones: titulo, aceptar, cancelar, tipo ("info" | "aviso" | "peligro" | "exito"),
 *           datos: [["Etiqueta", "valor"], ...]  (se muestran como lista)
 */
(function () {
    "use strict";

    const ICONOS = { info: "i", aviso: "!", peligro: "!", exito: "✓" };

    const css = `
.dlg-fondo{
    position:fixed; inset:0; z-index:1000; background:rgba(16,24,40,.55);
    display:flex; align-items:center; justify-content:center; padding:16px;
    opacity:0; transition:opacity .15s ease;
}
.dlg-fondo.visible{ opacity:1; }
.dlg{
    width:min(440px,100%); background:#fff; color:#17202a; border-radius:16px;
    box-shadow:0 20px 50px rgba(0,0,0,.25); padding:22px 22px 18px;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
    transform:translateY(8px) scale(.98); transition:transform .15s ease;
}
.dlg-fondo.visible .dlg{ transform:none; }
.dlg-cabeza{ display:flex; align-items:center; gap:12px; margin-bottom:10px; }
.dlg-icono{
    flex:0 0 38px; height:38px; border-radius:50%; display:flex; align-items:center; justify-content:center;
    font-weight:800; font-size:18px; background:#e6f2eb; color:#0d5c37;
}
.dlg[data-tipo="aviso"] .dlg-icono{ background:#fff4e0; color:#9a5b00; }
.dlg[data-tipo="peligro"] .dlg-icono{ background:#fdecea; color:#c62828; }
.dlg[data-tipo="exito"] .dlg-icono{ background:#e8f5e9; color:#16803c; }
.dlg-titulo{ margin:0; font-size:17px; font-weight:700; color:#0d5c37; line-height:1.3; }
.dlg[data-tipo="peligro"] .dlg-titulo{ color:#c62828; }
.dlg-mensaje{ margin:0; font-size:15px; line-height:1.45; color:#344054; white-space:pre-line; }
.dlg-datos{
    margin:12px 0 0; padding:10px 12px; background:#f5f7fa; border:1px solid #e4e9ef; border-radius:10px;
    display:grid; grid-template-columns:auto 1fr; gap:6px 12px; font-size:14px;
}
.dlg-datos dt{ font-weight:700; color:#52514e; }
.dlg-datos dd{ margin:0; color:#17202a; word-break:break-word; }
.dlg-pasos{ margin:12px 0 0; padding:0; list-style:none; counter-reset:paso; display:flex; flex-direction:column; gap:8px; }
.dlg-pasos li{
    counter-increment:paso; position:relative; padding:9px 10px 9px 42px; background:#f3f8f5;
    border:1px solid #e1ebe5; border-radius:10px; font-size:14px; line-height:1.4; color:#14211a;
}
.dlg-pasos li::before{
    content:counter(paso); position:absolute; left:10px; top:9px; width:22px; height:22px; border-radius:50%;
    background:#0d5c37; color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center;
}
.dlg-pasos b{ color:#0a4a2c; }
.dlg-subtitulo{ margin:14px 0 0; font-size:12px; font-weight:800; color:#0a4a2c; text-transform:uppercase; letter-spacing:.04em; }
.dlg-nota{ margin:12px 0 0; font-size:12.5px; color:#5d6b64; }
.dlg{ max-height:calc(100vh - 32px); overflow-y:auto; }
.dlg-botones{ display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
.dlg-botones button{
    border:none; border-radius:9px; padding:11px 18px; min-height:44px; font-size:15px; font-weight:700;
    font-family:inherit; cursor:pointer;
}
.dlg-cancelar{ background:#eef2f6; color:#263238; }
.dlg-cancelar:hover{ background:#e2e8ef; }
.dlg-aceptar{ background:#0d5c37; color:#fff; }
.dlg-aceptar:hover{ background:#0a4a2c; }
.dlg[data-tipo="peligro"] .dlg-aceptar{ background:#c62828; }
.dlg[data-tipo="peligro"] .dlg-aceptar:hover{ background:#a61f1f; }
.dlg-botones button:focus-visible{ outline:3px solid rgba(18,122,71,.35); outline-offset:2px; }
@media (max-width:520px){
    .dlg-fondo{ align-items:flex-end; padding:0; }
    .dlg{ width:100%; border-radius:18px 18px 0 0; padding:22px 18px calc(18px + env(safe-area-inset-bottom)); }
    .dlg-botones button{ flex:1; }
}
@media (prefers-reduced-motion:reduce){
    .dlg-fondo, .dlg{ transition:none; }
}`;

    const estilo = document.createElement("style");
    estilo.textContent = css;
    document.head.appendChild(estilo);

    let abierto = null;

    function dialogo(op) {
        const o = Object.assign({ titulo: "", mensaje: "", aceptar: "Aceptar", cancelar: null, tipo: "info", datos: null, grupos: null, nota: "" }, op);
        if (abierto) abierto.cerrar(false);

        return new Promise(resolve => {
            const anterior = document.activeElement;
            const fondo = document.createElement("div");
            fondo.className = "dlg-fondo";

            const caja = document.createElement("div");
            caja.className = "dlg";
            caja.dataset.tipo = o.tipo;
            caja.setAttribute("role", o.cancelar ? "alertdialog" : "dialog");
            caja.setAttribute("aria-modal", "true");

            const cabeza = document.createElement("div");
            cabeza.className = "dlg-cabeza";
            const icono = document.createElement("span");
            icono.className = "dlg-icono";
            icono.setAttribute("aria-hidden", "true");
            icono.textContent = ICONOS[o.tipo] || "i";
            const titulo = document.createElement("h2");
            titulo.className = "dlg-titulo";
            titulo.id = "dlg-titulo-" + Date.now();
            titulo.textContent = o.titulo || (o.cancelar ? "Confirmar" : "Aviso");
            caja.setAttribute("aria-labelledby", titulo.id);
            cabeza.append(icono, titulo);

            const mensaje = document.createElement("p");
            mensaje.className = "dlg-mensaje";
            mensaje.textContent = o.mensaje;

            caja.append(cabeza, mensaje);

            if (Array.isArray(o.datos) && o.datos.length) {
                const dl = document.createElement("dl");
                dl.className = "dlg-datos";
                o.datos.forEach(([k, v]) => {
                    const dt = document.createElement("dt"); dt.textContent = k;
                    const dd = document.createElement("dd"); dd.textContent = v;
                    dl.append(dt, dd);
                });
                caja.appendChild(dl);
            }

            // grupos: [{ titulo, pasos: ["texto con <b>negritas</b>", ...] }]  (texto propio, no del usuario)
            if (Array.isArray(o.grupos)) {
                o.grupos.forEach(g => {
                    if (g.titulo) {
                        const h = document.createElement("p");
                        h.className = "dlg-subtitulo";
                        h.textContent = g.titulo;
                        caja.appendChild(h);
                    }
                    const ol = document.createElement("ol");
                    ol.className = "dlg-pasos";
                    g.pasos.forEach(t => {
                        const li = document.createElement("li");
                        li.innerHTML = t;
                        ol.appendChild(li);
                    });
                    caja.appendChild(ol);
                });
            }
            if (o.nota) {
                const n = document.createElement("p");
                n.className = "dlg-nota";
                n.textContent = o.nota;
                caja.appendChild(n);
            }

            const botones = document.createElement("div");
            botones.className = "dlg-botones";
            let btnCancelar = null;
            if (o.cancelar) {
                btnCancelar = document.createElement("button");
                btnCancelar.type = "button";
                btnCancelar.className = "dlg-cancelar";
                btnCancelar.textContent = o.cancelar;
                botones.appendChild(btnCancelar);
            }
            const btnAceptar = document.createElement("button");
            btnAceptar.type = "button";
            btnAceptar.className = "dlg-aceptar";
            btnAceptar.textContent = o.aceptar;
            botones.appendChild(btnAceptar);
            caja.appendChild(botones);

            fondo.appendChild(caja);
            document.body.appendChild(fondo);
            const overflowPrevio = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            requestAnimationFrame(() => fondo.classList.add("visible"));

            function teclas(e) {
                if (e.key === "Escape") { e.preventDefault(); cerrar(false); }
                if (e.key === "Tab") {
                    const f = [btnCancelar, btnAceptar].filter(Boolean);
                    const i = f.indexOf(document.activeElement);
                    e.preventDefault();
                    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
                }
            }

            function cerrar(valor) {
                document.removeEventListener("keydown", teclas, true);
                fondo.classList.remove("visible");
                document.body.style.overflow = overflowPrevio;
                setTimeout(() => fondo.remove(), 150);
                abierto = null;
                if (anterior && anterior.focus) anterior.focus({ preventScroll: true });
                resolve(valor);
            }

            btnAceptar.addEventListener("click", () => cerrar(true));
            if (btnCancelar) btnCancelar.addEventListener("click", () => cerrar(false));
            fondo.addEventListener("click", e => { if (e.target === fondo) cerrar(false); });
            document.addEventListener("keydown", teclas, true);

            abierto = { cerrar };
            setTimeout(() => (o.tipo === "peligro" && btnCancelar ? btnCancelar : btnAceptar).focus(), 30);
        });
    }

    window.dialogo = dialogo;
    window.avisar = (mensaje, op = {}) => dialogo(Object.assign({ mensaje }, op));
    window.confirmar = (mensaje, op = {}) => dialogo(Object.assign({ mensaje, cancelar: "Cancelar" }, op));
})();
