-- Base de datos de caracterizaciones (Cloudflare D1)

CREATE TABLE IF NOT EXISTS registros (
    id              TEXT PRIMARY KEY,
    fecha_registro  TEXT NOT NULL,          -- hora del dispositivo (ISO 8601)
    recibido_en     TEXT NOT NULL,          -- hora del servidor (ISO 8601)
    municipio       TEXT NOT NULL,
    barrio          TEXT NOT NULL,
    direccion       TEXT NOT NULL,
    direccion_gps   TEXT,                   -- lo que sugirió el GPS, como respaldo
    latitud         REAL NOT NULL,
    longitud        REAL NOT NULL,
    precision_m     INTEGER,
    coordenadas     TEXT,
    tipo_expendio   TEXT NOT NULL,
    actor           TEXT,
    sustancia       TEXT,
    venezolanos     TEXT,
    marquillas      TEXT,
    funcionarios    TEXT NOT NULL,          -- texto legible: "ZAP 12 · SI Nombre" por línea
    zap             TEXT,                   -- códigos ZAP del registro, separados por coma
    funcionarios_json TEXT,                 -- [{ zap, sigla, grado, nombre }]
    correo_registra TEXT,                   -- correo de quien diligencia
    nombre_registra TEXT,                   -- nombre completo de quien diligencia
    sustancias_json TEXT                    -- [{ id, nombre, otra, valor }]
);

CREATE INDEX IF NOT EXISTS idx_registros_recibido ON registros(recibido_en);
CREATE INDEX IF NOT EXISTS idx_registros_municipio ON registros(municipio);

CREATE TABLE IF NOT EXISTS fotos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    registro_id   TEXT NOT NULL REFERENCES registros(id) ON DELETE CASCADE,
    tipo          TEXT NOT NULL CHECK (tipo IN ('actor','marquilla','punto')),
    orden         INTEGER NOT NULL,
    r2_key        TEXT NOT NULL UNIQUE,     -- foto original, tal como se tomó
    mini_key      TEXT,                     -- miniatura para el panel y el Excel
    tamano        INTEGER,
    content_type  TEXT
);

CREATE INDEX IF NOT EXISTS idx_fotos_registro ON fotos(registro_id);
