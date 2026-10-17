-- Lote L6 (17-oct-2026): estadisticas de lectura SIN cookies ni datos personales.
-- Cada fila es un evento anonimo; el visitante es un hash diario (sha256 con sal que rota cada dia
-- y no se guarda), asi que no permite seguir a una persona entre dias. No se guarda IP ni user-agent.
-- Aditiva e idempotente. El borrado de una edicion arrastra sus eventos (ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS reader_events (
    id             bigserial PRIMARY KEY,
    tenant_id      uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    publication_id uuid        NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    day            date        NOT NULL,
    visitor        char(16)    NOT NULL,
    event          varchar(6)  NOT NULL,   -- open | view | time | click
    page           integer,                -- view / time
    ms             integer,                -- time: milisegundos activos en la pagina
    act            varchar(10),            -- click: url | email | phone | page
    target         varchar(120),           -- click url: solo el dominio de destino
    src            varchar(12),            -- origen declarado: qr | wa | ...
    ref_host       varchar(120),           -- dominio de referencia (en embed: la web que lo inserta)
    embed          boolean     NOT NULL DEFAULT false,
    country        char(2),
    device         varchar(8),             -- mobile | tablet | desktop
    browser        varchar(10),
    os             varchar(10),
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_reader_events_pub_day    ON reader_events (publication_id, day);
CREATE INDEX IF NOT EXISTS ix_reader_events_tenant_day ON reader_events (tenant_id, day);
-- una "lectura" = una apertura unica por visitante, edicion y dia (recargar 10 veces cuenta 1)
CREATE UNIQUE INDEX IF NOT EXISTS ux_reader_events_open ON reader_events (publication_id, day, visitor) WHERE event = 'open';
