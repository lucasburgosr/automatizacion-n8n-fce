create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists users (
    id uuid primary key default gen_random_uuid(),
    phone text not null unique,
    full_name text,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    metadata jsonb not null default '{}'::jsonb
);

create table if not exists conversations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users(id),
    status text not null default 'open' check (status in ('open', 'closed', 'handoff')),
    started_at timestamptz not null default now(),
    last_message_at timestamptz not null default now(),
    closed_at timestamptz,
    summary text,
    metadata jsonb not null default '{}'::jsonb
);

create index if not exists conversations_user_status_idx
    on conversations (user_id, status, last_message_at desc);

create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations(id),
    external_message_id text,
    direction text not null check (direction in ('inbound', 'outbound')),
    message_type text not null,
    body text,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
    on messages (conversation_id, created_at desc);

create table if not exists faqs (
    id uuid primary key default gen_random_uuid(),
    tema text not null,
    subtemas text,
    posible_pregunta text not null,
    respuesta text not null,
    question_normalized text not null unique,
    embedding vector(1536),
    active boolean not null default true,
    source_hash text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists faqs_active_idx
    on faqs (active);

create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    source_url text,
    source_type text not null default 'institutional',
    checksum text not null unique,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists document_chunks (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references documents(id),
    chunk_index integer not null,
    chunk_text text not null,
    embedding vector(1536),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (document_id, chunk_index)
);

create table if not exists handoff_requests (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references conversations(id),
    reason text not null,
    status text not null default 'pending' check (status in ('pending', 'assigned', 'resolved')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);

create table if not exists interaction_logs (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references conversations(id),
    message_id uuid references messages(id),
    step text not null,
    decision text,
    confidence double precision,
    payload_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_faqs_updated_at on faqs;
create trigger trg_faqs_updated_at
before update on faqs
for each row
execute function set_updated_at();

drop trigger if exists trg_documents_updated_at on documents;
create trigger trg_documents_updated_at
before update on documents
for each row
execute function set_updated_at();

create or replace function match_faqs(
    query_embedding vector(1536),
    similarity_threshold double precision default 0.84,
    match_count integer default 3
)
returns table (
    id uuid,
    tema text,
    subtemas text,
    posible_pregunta text,
    respuesta text,
    similarity double precision
)
language sql
stable
as $$
    select
        f.id,
        f.tema,
        f.subtemas,
        f.posible_pregunta,
        f.respuesta,
        1 - (f.embedding <=> query_embedding) as similarity
    from faqs f
    where f.active = true
      and f.embedding is not null
      and 1 - (f.embedding <=> query_embedding) >= similarity_threshold
    order by f.embedding <=> query_embedding
    limit match_count;
$$;

create or replace function match_document_chunks(
    query_embedding vector(1536),
    similarity_threshold double precision default 0.80,
    match_count integer default 5
)
returns table (
    id uuid,
    document_id uuid,
    chunk_index integer,
    chunk_text text,
    similarity double precision
)
language sql
stable
as $$
    select
        c.id,
        c.document_id,
        c.chunk_index,
        c.chunk_text,
        1 - (c.embedding <=> query_embedding) as similarity
    from document_chunks c
    join documents d on d.id = c.document_id
    where d.active = true
      and c.embedding is not null
      and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
    order by c.embedding <=> query_embedding
    limit match_count;
$$;
