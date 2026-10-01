import os
import sys
import tempfile
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tasktracker import importers  # noqa: E402
from tasktracker.storage import Store, next_occurrence  # noqa: E402
from tasktracker.xlsx import read_xlsx, write_xlsx  # noqa: E402

SAMPLES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "samples")


def read(path):
    with open(path, "rb") as f:
        return f.read()


def sample(name):
    return read(os.path.join(SAMPLES, name))


class ImportTests(unittest.TestCase):
    def test_csv(self):
        tasks, _ = importers.parse_file("sales_tasks.csv", sample("sales_tasks.csv"))
        self.assertEqual(len(tasks), 5)
        t = tasks[1]
        self.assertEqual((t["title"], t["priority"], t["status"], t["due_date"], t["list"]),
                         ("Send proposal to Fabrikam", "urgent", "in_progress", "2026-10-01", "Fabrikam"))
        self.assertEqual(tasks[0]["labels"], ["Renewal", "Call"])
        self.assertEqual(tasks[2]["recurrence"], "weekly")
        self.assertEqual(tasks[4]["status"], "done")

    def test_xlsx(self):
        tasks, _ = importers.parse_file("pipeline.xlsx", sample("pipeline.xlsx"), default_list="Sales")
        self.assertEqual(len(tasks), 3)
        self.assertEqual(tasks[0]["list"], "Adventure Works")
        self.assertEqual(tasks[1]["priority"], "urgent")

    def test_text(self):
        tasks, _ = importers.parse_file("weekly_plan.txt", sample("weekly_plan.txt"))
        self.assertEqual(len(tasks), 5)
        self.assertEqual(tasks[0]["title"], "Prepare Monday sales stand-up")
        self.assertEqual((tasks[0]["priority"], tasks[0]["recurrence"], tasks[0]["due_date"]), ("high", "weekly", "2026-10-05"))
        self.assertEqual(tasks[1]["due_date"], (date.today() + timedelta(days=1)).isoformat())
        self.assertEqual(tasks[3]["status"], "done")

    def test_excel_serial_and_formats(self):
        self.assertEqual(importers.parse_date(46296), "2026-10-01")
        self.assertEqual(importers.parse_date("15/10/2026"), "2026-10-15")
        self.assertEqual(importers.parse_date("Oct 5, 2026"), "2026-10-05")

    def test_headerless_csv(self):
        tasks, warn = importers.parse_file("x.csv", b"Buy milk\nCall mom\n")
        self.assertEqual([t["title"] for t in tasks], ["Buy milk", "Call mom"])
        self.assertTrue(warn)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = Store(self.dir)

    def test_exports_written(self):
        self.store.create({"title": "A", "labels": "x, y"})
        for f in ("tasks.json", "tasks.csv", "tasks.xlsx"):
            self.assertTrue(os.path.exists(os.path.join(self.dir, f)))
        rows = read_xlsx(read(os.path.join(self.dir, "tasks.xlsx")))["Tasks"]
        self.assertEqual(rows[1][1], "A")

    def test_recurring_rolls_forward(self):
        t = self.store.create({"title": "Report", "due_date": "2026-01-31", "recurrence": "monthly"})
        u = self.store.update(t["id"], {"status": "done"})
        self.assertEqual((u["status"], u["due_date"]), ("todo", "2026-02-28"))
        self.assertEqual(next_occurrence("2026-10-01", "yearly").isoformat(), "2027-10-01")

    def test_bulk_dedup(self):
        items = [{"title": "X", "source_ref": "r1"}, {"title": "Y", "source_ref": "r2"}]
        self.assertEqual(len(self.store.bulk_create(items)[0]), 2)
        created, skipped = self.store.bulk_create(items)
        self.assertEqual((len(created), skipped), (0, 2))

    def test_xlsx_roundtrip(self):
        p = os.path.join(self.dir, "t.xlsx")
        write_xlsx(p, ["a", "b"], [["1 & <2>", "é"]])
        self.assertEqual(read_xlsx(read(p))["Tasks"], [["a", "b"], ["1 & <2>", "é"]])


if __name__ == "__main__":
    unittest.main()
