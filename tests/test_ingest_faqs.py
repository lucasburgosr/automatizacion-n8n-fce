import textwrap
import unittest
from pathlib import Path

from scripts.ingest_faqs import clean_text, load_csv_records, normalize_header, normalize_question


class IngestFaqsTests(unittest.TestCase):
    def test_normalize_header_aliases_subtema(self) -> None:
        self.assertEqual(normalize_header("Subtema"), "subtemas")

    def test_clean_text_repairs_mojibake(self) -> None:
        self.assertEqual(clean_text("InformaciÃ³n"), "Información")

    def test_normalize_question_removes_accents_and_punctuation(self) -> None:
        self.assertEqual(normalize_question("¿Cómo extiendo la regularidad?"), "como extiendo la regularidad")

    def test_load_csv_records_deduplicates_by_question(self) -> None:
        content = textwrap.dedent(
            """\
            Tema;Subtema;Posible pregunta;Respuesta
            Cursadas;Regularidad;¿Qué es regularidad?;Respuesta 1
            Cursadas;Regularidad;¿Qué es regularidad?;Respuesta 2
            """
        )
        tmp_dir = Path("tests/.tmp")
        tmp_dir.mkdir(parents=True, exist_ok=True)
        csv_path = tmp_dir / "faqs.csv"
        csv_path.write_text(content, encoding="utf-8")
        records = load_csv_records(csv_path)
        csv_path.unlink()

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].respuesta, "Respuesta 2")


if __name__ == "__main__":
    unittest.main()
