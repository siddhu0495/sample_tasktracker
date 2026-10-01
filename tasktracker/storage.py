"""Task storage: tasks.json is the source of truth; every save also writes
tasks.csv and tasks.xlsx next to it so the data is always usable in Excel."""
import csv
import json
import os
import threading
import uuid
from datetime import date, datetime, timedelta

from .xlsx import write_xlsx

STATUSES = ["todo", "in_progress", "in_review", "done"]
PRIORITIES = ["urgent", "high", "normal", "low"]
RECURRENCES = ["none", "daily", "weekly", "monthly", "yearly"]

FIELDS = [
    "id", "title", "status", "priority", "list", "assignee", "labels",
    "start_date", "due_date", "recurrence", "description", "notes",
    "source", "source_ref", "created_at", "updated_at", "completed_at",
]
DEFAULT_LISTS = ["My Tasks", "Sales", "Meetings"]


def now_iso():
    return datetime.now().replace(microsecond=0).isoformat()


def blank_task():
    return {
        "id": "", "title": "", "status": "todo", "priority": "normal",
        "list": DEFAULT_LISTS[0], "assignee": "", "labels": [],
        "start_date": "", "due_date": "", "recurrence": "none",
        "description": "", "notes": "", "source": "manual", "source_ref": "",
        "created_at": "", "updated_at": "", "completed_at": "",
    }


def clean_task(data, base=None):
    t = dict(base or blank_task())
    for k in FIELDS:
        if k in data and k != "id":
            t[k] = data[k]
    t["title"] = str(t["title"] or "").strip() or "Untitled task"
    if t["status"] not in STATUSES:
        t["status"] = "todo"
    if t["priority"] not in PRIORITIES:
        t["priority"] = "normal"
    if t["recurrence"] not in RECURRENCES:
        t["recurrence"] = "none"
    if isinstance(t["labels"], str):
        t["labels"] = [x.strip() for x in t["labels"].replace(";", ",").split(",") if x.strip()]
    t["list"] = str(t["list"] or DEFAULT_LISTS[0]).strip()
    for k in ("start_date", "due_date"):
        t[k] = str(t[k] or "")[:10]
    return t


def _add_months(d, months, day):
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    for dd in (day, 30, 29, 28):
        try:
            return date(y, m, dd)
        except ValueError:
            continue


def next_occurrence(due, rec):
    d = date.fromisoformat(due) if due else date.today()
    if rec == "daily":
        return d + timedelta(days=1)
    if rec == "weekly":
        return d + timedelta(weeks=1)
    if rec == "monthly":
        return _add_months(d, 1, d.day)
    if rec == "yearly":
        return _add_months(d, 12, d.day)
    return d


class Store:
    def __init__(self, data_dir):
        self.dir = data_dir
        os.makedirs(data_dir, exist_ok=True)
        self.path = os.path.join(data_dir, "tasks.json")
        self.lock = threading.RLock()
        self.data = {"workspace": "My Workspace", "lists": list(DEFAULT_LISTS), "tasks": []}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.data.update(json.load(f))
        else:
            self.save()

    # ---- persistence -------------------------------------------------
    def save(self):
        with self.lock:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)
            self._export()

    def _export(self):
        headers = [f for f in FIELDS if f != "source_ref"]
        rows = []
        for t in self.data["tasks"]:
            rows.append([", ".join(t[h]) if h == "labels" else t.get(h, "") for h in headers])
        try:
            with open(os.path.join(self.dir, "tasks.csv"), "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                w.writerow(headers)
                w.writerows(rows)
            write_xlsx(os.path.join(self.dir, "tasks.xlsx"), headers, rows)
        except PermissionError:
            pass  # file open in Excel; JSON is still saved, exports refresh next save

    # ---- queries / mutations ----------------------------------------
    def state(self):
        with self.lock:
            return json.loads(json.dumps(self.data))

    def _find(self, task_id):
        for t in self.data["tasks"]:
            if t["id"] == task_id:
                return t
        return None

    def _ensure_list(self, name):
        if name and name not in self.data["lists"]:
            self.data["lists"].append(name)

    def create(self, payload, save=True):
        with self.lock:
            t = clean_task(payload)
            t["id"] = uuid.uuid4().hex[:12]
            t["created_at"] = t["updated_at"] = now_iso()
            if t["status"] == "done":
                t["completed_at"] = now_iso()
            self._ensure_list(t["list"])
            self.data["tasks"].append(t)
            if save:
                self.save()
            return t

    def bulk_create(self, items):
        with self.lock:
            refs = {t.get("source_ref") for t in self.data["tasks"] if t.get("source_ref")}
            created, skipped = [], 0
            for it in items:
                ref = it.get("source_ref")
                if ref and ref in refs:
                    skipped += 1
                    continue
                created.append(self.create(it, save=False))
                if ref:
                    refs.add(ref)
            self.save()
            return created, skipped

    def update(self, task_id, payload):
        with self.lock:
            t = self._find(task_id)
            if not t:
                return None
            was_done = t["status"] == "done"
            new = clean_task(payload, base=t)
            if new["status"] == "done" and not was_done:
                if new["recurrence"] != "none":
                    # recurring: roll forward to the next occurrence instead of closing
                    nxt = next_occurrence(new["due_date"] or new["start_date"], new["recurrence"])
                    new["due_date"] = nxt.isoformat()
                    new["status"] = "todo"
                    new["completed_at"] = now_iso()
                else:
                    new["completed_at"] = now_iso()
            elif new["status"] != "done" and new["recurrence"] == "none":
                new["completed_at"] = ""
            new["updated_at"] = now_iso()
            self._ensure_list(new["list"])
            t.clear()
            t.update(new)
            self.save()
            return t

    def delete(self, task_id):
        with self.lock:
            before = len(self.data["tasks"])
            self.data["tasks"] = [t for t in self.data["tasks"] if t["id"] != task_id]
            self.save()
            return len(self.data["tasks"]) < before

    def set_meta(self, payload):
        with self.lock:
            if "workspace" in payload:
                self.data["workspace"] = str(payload["workspace"]).strip() or "My Workspace"
            if "lists" in payload and isinstance(payload["lists"], list):
                names = [str(x).strip() for x in payload["lists"] if str(x).strip()]
                self.data["lists"] = list(dict.fromkeys(names)) or list(DEFAULT_LISTS)
            if "rename_list" in payload:
                old, new = payload["rename_list"].get("from"), str(payload["rename_list"].get("to", "")).strip()
                if old and new:
                    self.data["lists"] = [new if x == old else x for x in self.data["lists"]]
                    for t in self.data["tasks"]:
                        if t["list"] == old:
                            t["list"] = new
            if "delete_list" in payload:
                name = payload["delete_list"]
                self.data["lists"] = [x for x in self.data["lists"] if x != name] or list(DEFAULT_LISTS)
                for t in self.data["tasks"]:
                    if t["list"] == name:
                        t["list"] = self.data["lists"][0]
            self.save()
            return self.state()
