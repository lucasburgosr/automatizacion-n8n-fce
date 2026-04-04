from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib import error, request

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


EXPECTED_COLUMNS = ("tema", "subtemas", "posible_pregunta", "respuesta")
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
MOJIBAKE_MARKERS = ("Ã", "Â", "â", "€", "™")


@dataclass
class FaqRecord:
    tema: str
    subtemas: str
    posible_pregunta: str
    respuesta: str
    question_normalized: str
    source_hash: str
    embedding: list[float] | None = None


def maybe_fix_mojibake(value: str) -> str:
    if not value or not any(marker in value for marker in MOJIBAKE_MARKERS):
        return value or ""
    try:
        repaired = value.encode("latin1").decode("utf-8")
    except UnicodeError:
        return value
    return repaired if repaired.count("�") <= value.count("�") else value


def clean_text(value: str | None) -> str:
    value = maybe_fix_mojibake((value or "").strip())
    value = value.replace("\ufeff", "")
    value = re.sub(r"\r\n?", "\n", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def normalize_header(value: str) -> str:
    normalized = clean_text(value).lower().replace(" ", "_")
    normalized = unicodedata.normalize("NFKD", normalized)
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^a-z0-9_]", "", normalized)
    aliases = {"subtema": "subtemas"}
    return aliases.get(normalized, normalized)


def normalize_question(value: str) -> str:
    normalized = clean_text(value).lower()
    normalized = unicodedata.normalize("NFKD", normalized)
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def build_source_hash(record: dict[str, str]) -> str:
    raw = "||".join(record[column] for column in EXPECTED_COLUMNS)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_csv_records(csv_path: Path) -> list[FaqRecord]:
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        sample = handle.read(2048)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
            reader = csv.DictReader(handle, dialect=dialect)
        except csv.Error:
            delimiter = ";" if sample.count(";") >= sample.count(",") else ","
            reader = csv.DictReader(handle, delimiter=delimiter)
        if reader.fieldnames is None:
            raise ValueError("El CSV no contiene cabeceras.")

        header_map = {field: normalize_header(field) for field in reader.fieldnames}
        missing = [column for column in EXPECTED_COLUMNS if column not in header_map.values()]
        if missing:
            raise ValueError(f"Faltan columnas requeridas: {', '.join(missing)}")

        deduped: dict[str, FaqRecord] = {}
        for row in reader:
            normalized_row = {
                header_map[key]: clean_text(value)
                for key, value in row.items()
                if key is not None
            }
            pregunta = normalized_row["posible_pregunta"]
            respuesta = normalized_row["respuesta"]
            if not pregunta or not respuesta:
                continue

            question_normalized = normalize_question(pregunta)
            canonical = {
                "tema": normalized_row.get("tema", ""),
                "subtemas": normalized_row.get("subtemas", ""),
                "posible_pregunta": pregunta,
                "respuesta": respuesta,
            }
            deduped[question_normalized] = FaqRecord(
                tema=canonical["tema"],
                subtemas=canonical["subtemas"],
                posible_pregunta=canonical["posible_pregunta"],
                respuesta=canonical["respuesta"],
                question_normalized=question_normalized,
                source_hash=build_source_hash(canonical),
            )

    return list(deduped.values())


def chunked(records: Iterable[FaqRecord], size: int) -> Iterable[list[FaqRecord]]:
    batch: list[FaqRecord] = []
    for record in records:
        batch.append(record)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def fetch_embeddings(records: list[FaqRecord], model: str, api_key: str, base_url: str) -> None:
    endpoint = f"{base_url.rstrip('/')}/embeddings"
    for batch in chunked(records, 50):
        payload = {"model": model, "input": [record.posible_pregunta for record in batch]}
        req = request.Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))
        except error.HTTPError as exc:  # pragma: no cover
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenAI embeddings error {exc.code}: {detail}") from exc

        data = body.get("data", [])
        if len(data) != len(batch):
            raise RuntimeError("La respuesta de embeddings no coincide con la cantidad de registros.")

        for record, item in zip(batch, data):
            record.embedding = item["embedding"]


def upsert_faqs(records: list[FaqRecord], dsn: str) -> int:
    if psycopg is None:
        raise RuntimeError("psycopg no está instalado. Instala requirements.txt antes de ejecutar la carga real.")

    query = """
    insert into faqs (
        tema, subtemas, posible_pregunta, respuesta, question_normalized,
        embedding, active, source_hash
    ) values (
        %(tema)s, %(subtemas)s, %(posible_pregunta)s, %(respuesta)s,
        %(question_normalized)s, %(embedding)s, true, %(source_hash)s
    )
    on conflict (question_normalized) do update set
        tema = excluded.tema,
        subtemas = excluded.subtemas,
        posible_pregunta = excluded.posible_pregunta,
        respuesta = excluded.respuesta,
        embedding = excluded.embedding,
        active = true,
        source_hash = excluded.source_hash,
        updated_at = now();
    """

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            for record in records:
                cur.execute(
                    query,
                    {
                        "tema": record.tema,
                        "subtemas": record.subtemas,
                        "posible_pregunta": record.posible_pregunta,
                        "respuesta": record.respuesta,
                        "question_normalized": record.question_normalized,
                        "embedding": record.embedding,
                        "source_hash": record.source_hash,
                    },
                )
    return len(records)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingesta FAQs FCE a Postgres + pgvector")
    parser.add_argument("--csv", default="preguntas_frecuentes.csv")
    parser.add_argument("--dsn", default=os.getenv("POSTGRES_DSN"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-embeddings", action="store_true")
    parser.add_argument("--embedding-model", default=os.getenv("OPENAI_EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL))
    parser.add_argument("--openai-api-key", default=os.getenv("OPENAI_API_KEY"))
    parser.add_argument("--openai-base-url", default=os.getenv("OPENAI_BASE_URL", DEFAULT_OPENAI_BASE_URL))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(json.dumps({"level": "error", "message": f"No existe el archivo {csv_path}"}))
        return 1

    records = load_csv_records(csv_path)
    if not records:
        print(json.dumps({"level": "warning", "message": "No se encontraron FAQs procesables"}))
        return 0

    if not args.skip_embeddings:
        if not args.openai_api_key:
            print(json.dumps({"level": "error", "message": "Falta OPENAI_API_KEY o --openai-api-key"}))
            return 1
        fetch_embeddings(records, args.embedding_model, args.openai_api_key, args.openai_base_url)

    print(json.dumps({
        "level": "info",
        "message": "Resumen de ingesta",
        "records": len(records),
        "with_embeddings": sum(1 for record in records if record.embedding is not None),
        "sample_question": records[0].posible_pregunta,
    }, ensure_ascii=False))

    if args.dry_run:
        return 0

    if not args.dsn:
        print(json.dumps({"level": "error", "message": "Falta POSTGRES_DSN o --dsn"}))
        return 1

    inserted = upsert_faqs(records, args.dsn)
    print(json.dumps({"level": "info", "message": "FAQs cargadas", "count": inserted}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
