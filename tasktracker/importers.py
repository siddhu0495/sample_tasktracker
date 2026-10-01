"""Turn CSV / Excel / text / JSON files into task dicts (preview before import)."""
import csv
import hashlib
import io
import json
import os
import re
from datetime import date, datetime, timedelta

from .xlsx import read_xlsx

SUPPORTED = (".csv", ".tsv", ".xlsx", ".xlsm", ".txt", ".md", ".json")

# header aliases -> task field (compared lower-case, non-alphanumerics stripped)
ALIASES = {
    "title": ["title", "task", "taskname", "name", "subject", "summary", "item", "action", "actionitem", "todo"],
    "description": ["description", "details", "desc", "body"],
    "notes": ["notes", "note", "comments", "comment", "remarks"],
    "status": ["status", "state", "stage", "complete", "completed", "done"],
    "priority": ["priority", "importance", "severity", "urgency"],
    "assignee": ["assignee", "assignedto", "owner", "responsible", "person", "salesrep", "rep"],
    "labels": ["labels", "label", "tags", "tag", "category", "categories", "type"],
    "list": ["list", "project", "space", "folder", "account", "client", "customer"],
    "start_date": ["startdate", "start", "begin", "from", "startson"],
    "due_date": ["duedate", "due", "deadline", "enddate", "end", "date", "targetdate", "by", "duedatetime"],
    "recurrence": ["recurrence", "repeat", "frequency", "recurring", "cadence"],
}
_ALIAS_LOOKUP = {a: f for f, names in ALIASES.items() for a in names}


def _key(h):
    return re.sub(r"[^a-z0-9]", "", str(h).lower())


def parse_date(v):
    if v in (None, ""):
        return ""
    if isinstance(v, (int, float)) and 20000 < v < 80000:  # Excel serial date
        return (date(1899, 12, 30) + timedelta(days=int(v))).isoformat()
    s = str(v).strip()
    low = s.lower()
    today = date.today()
    if low == "today":
        return today.isoformat()
    if low == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if low == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    if re.fullmatch(r"\d{5}(\.\d+)?", s):
        return parse_date(float(s))
    s = re.sub(r"[T ]\d{1,2}:\d{2}.*$", "", s).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%m/%d/%Y", "%d.%m.%Y",
                "%d %b %Y", "%d %B %Y", "%b %d %Y", "%B %d %Y", "%b %d, %Y", "%B %d, %Y",
                "%d-%b-%Y", "%d-%b-%y", "%d/%m/%y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def norm_priority(v):
    s = str(v or "").strip().lower()
    if s in ("urgent", "critical", "p0", "1", "highest", "blocker", "asap"):
        return "urgent"
    if s in ("high", "p1", "2", "important", "2 (high)") or s.startswith("high"):
        return "high"
    if s in ("low", "p3", "4", "lowest", "0 (low)", "minor") or s.startswith("low"):
        return "low"
    return "normal"


def norm_status(v):
    s = str(v or "").strip().lower()
    if s in ("done", "completed", "complete", "closed", "finished", "yes", "true", "x", "y", "resolved", "won"):
        return "done"
    if "progress" in s or s in ("doing", "started", "wip", "active", "working"):
        return "in_progress"
    if "review" in s or s in ("waiting", "pending approval", "blocked"):
        return "in_review"
    return "todo"


def norm_recurrence(v):
    s = str(v or "").strip().lower()
    for r in ("daily", "weekly", "monthly", "yearly"):
        if s.startswith(r[:4]) or s == r:
            return r
    if s in ("annual", "annually", "every year"):
        return "yearly"
    return "none"


def _ref(source, *parts):
    return source + ":" + hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:16]


def rows_to_tasks(rows, source, default_list=""):
    """rows: list of lists; first non-empty row is the header."""
    rows = [r for r in rows if any(str(c).strip() for c in r)]
    if not rows:
        return [], ["File is empty."]
    header = [_key(h) for h in rows[0]]
    mapping = {}
    for i, h in enumerate(header):
        f = _ALIAS_LOOKUP.get(h)
        if f and f not in mapping.values():
            mapping[i] = f
    warnings = []
    if "title" not in mapping.values():
        # no recognisable header: first column is the title, keep every row
        warnings.append("No 'Title/Task' column found - first column used as the task title.")
        mapping = {0: "title"}
        data_rows = rows
        extra_cols = []
    else:
        data_rows = rows[1:]
        extra_cols = [i for i in range(len(header)) if i not in mapping and rows[0][i] != ""]

    tasks = []
    for n, r in enumerate(data_rows):
        t = {"source": source, "labels": []}
        for i, f in mapping.items():
            if i >= len(r):
                continue
            v = r[i]
            if f in ("start_date", "due_date"):
                t[f] = parse_date(v)
            elif f == "priority":
                t[f] = norm_priority(v)
            elif f == "status":
                t[f] = norm_status(v)
            elif f == "recurrence":
                t[f] = norm_recurrence(v)
            elif f == "labels":
                t[f] = [x.strip() for x in re.split(r"[,;]", str(v)) if x.strip()]
            else:
                t[f] = str(v).strip()
        if not t.get("title"):
            continue
        extras = [f"{rows[0][i]}: {r[i]}" for i in extra_cols if i < len(r) and str(r[i]).strip()]
        if extras:
            t["notes"] = (t.get("notes", "") + "\n" if t.get("notes") else "") + "\n".join(extras)
        if default_list and not t.get("list"):
            t["list"] = default_list
        t["source_ref"] = _ref(source, n, t["title"], t.get("due_date", ""))
        tasks.append(t)
    return tasks, warnings


_BULLET = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+")
_CHECK = re.compile(r"^\[( |x|X)\]\s*")
_DATE_HINT = re.compile(r"\s*(?:@|\bdue[: ]|\bby[: ])\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|today|tomorrow)\s*", re.I)
_PRIO_HINT = re.compile(r"\s*(?:!|\()\s*(urgent|high|normal|low)\)?\s*", re.I)
_REC_HINT = re.compile(r"\s*\b(?:every\s+)?(daily|weekly|monthly|yearly)\b\s*", re.I)


def text_to_tasks(text, source, default_list=""):
    tasks = []
    for n, line in enumerate(text.splitlines()):
        raw = line.strip()
        if not raw or raw.startswith("#"):
            continue
        s = _BULLET.sub("", raw)
        t = {"source": source, "status": "todo"}
        m = _CHECK.match(s)
        if m:
            t["status"] = "done" if m.group(1).lower() == "x" else "todo"
            s = s[m.end():]
        m = _DATE_HINT.search(s)
        if m:
            t["due_date"] = parse_date(m.group(1))
            s = (s[:m.start()] + " " + s[m.end():]).strip()
        m = _PRIO_HINT.search(s)
        if m:
            t["priority"] = norm_priority(m.group(1))
            s = (s[:m.start()] + " " + s[m.end():]).strip()
        m = _REC_HINT.search(s)
        if m:
            t["recurrence"] = norm_recurrence(m.group(1))
            s = (s[:m.start()] + " " + s[m.end():]).strip()
        if not s:
            continue
        t["title"] = s
        if default_list:
            t["list"] = default_list
        t["source_ref"] = _ref(source, n, s)
        tasks.append(t)
    return tasks, []


def _decode(data):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "ignore")


def parse_file(filename, data, default_list=""):
    """Return (tasks, warnings) for one file's bytes."""
    name = os.path.basename(filename)
    ext = os.path.splitext(name)[1].lower()
    source = f"file:{name}"
    if ext in (".xlsx", ".xlsm"):
        tasks, warnings = [], []
        for sheet, rows in read_xlsx(data).items():
            st, sw = rows_to_tasks(rows, f"{source}#{sheet}", default_list)
            tasks += st
            warnings += [f"[{sheet}] {w}" for w in sw if st]
        return tasks, warnings
    if ext == ".xls":
        return [], ["Old .xls format is not supported - in Excel use File > Save As > .xlsx."]
    text = _decode(data)
    if ext == ".json":
        obj = json.loads(text)
        items = obj.get("tasks", obj) if isinstance(obj, dict) else obj
        if not isinstance(items, list) or not items:
            return [], ["JSON must be a list of task objects (or {\"tasks\": [...]})."]
        header = list(dict.fromkeys(k for it in items if isinstance(it, dict) for k in it))
        rows = [header] + [[it.get(h, "") if not isinstance(it.get(h), list) else ", ".join(map(str, it.get(h)))
                            for h in header] for it in items if isinstance(it, dict)]
        return rows_to_tasks(rows, source, default_list)
    if ext in (".csv", ".tsv") or (ext == ".txt" and _looks_tabular(text)):
        delim = "\t" if ext == ".tsv" or text.split("\n", 1)[0].count("\t") else None
        if delim is None:
            try:
                delim = csv.Sniffer().sniff(text[:4096], delimiters=",;|\t").delimiter
            except csv.Error:
                delim = ","
        rows = list(csv.reader(io.StringIO(text), delimiter=delim))
        return rows_to_tasks(rows, source, default_list)
    if ext in (".txt", ".md", ""):
        return text_to_tasks(text, source, default_list)
    return [], [f"Unsupported file type: {ext}"]


def _looks_tabular(text):
    first = _key(text.split("\n", 1)[0].split(",")[0].split("\t")[0])
    return first in _ALIAS_LOOKUP and ("," in text[:200] or "\t" in text[:200])


def parse_folder(path, recursive=True, default_list=""):
    if not os.path.isdir(path):
        return [], [f"Folder not found: {path}"]
    tasks, warnings, count = [], [], 0
    for root, dirs, files in os.walk(path):
        for fn in sorted(files):
            if fn.startswith("~$") or not fn.lower().endswith(SUPPORTED):
                continue
            count += 1
            try:
                with open(os.path.join(root, fn), "rb") as f:
                    t, w = parse_file(fn, f.read(), default_list)
                tasks += t
                warnings += [f"{fn}: {x}" for x in w]
            except Exception as e:  # keep going on bad files
                warnings.append(f"{fn}: could not read ({e})")
        if not recursive:
            break
    if count == 0:
        warnings.append("No CSV / Excel / text files found in this folder.")
    return tasks, warnings
