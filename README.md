# Daily Task Tracker

A ClickUp-style task tracker that opens as a desktop app window with one double-click. You don't need to install anything, and everything stays on your PC.

## Start it (business users)

1. Download **TaskTracker-Windows** from this repo's **Actions** tab (open the latest *Build Windows app* run and go to *Artifacts*), or from **Releases** once a `v*` tag is pushed.
2. Unzip it anywhere, for example `Documents\TaskTracker`.
3. Double-click **`TaskTracker.exe`** (or **`Start TaskTracker.bat`**).

The app opens in its own window (Microsoft Edge app mode). Closing the window stops the app after about 3 minutes.

> Windows SmartScreen may warn about an unsigned app the first time. Click **More info → Run anyway**.

If Python happens to be installed, you can also double-click **`TaskTracker.pyw`**. No packages are needed.

## Features

| Area | What you get |
|---|---|
| Tasks | Title, status (To Do / In Progress / In Review / Complete), priority (Urgent / High / Normal / Low), list, assignee, labels, start and due dates, repeat, description, notes |
| Views | **Planner** (Overdue, Today, This Week, This Month and This Year side by side), **List** (grouped by status, like ClickUp), **Board** (drag and drop), **Calendar** (month grid) |
| Daily / weekly / monthly / yearly | Sidebar filters with counts. Repeating tasks show on every date they recur, and completing one moves it to its next due date |
| Lists | Group tasks by client, project or territory. You can create, rename and delete lists |
| Import: files | Drag and drop **Excel (.xlsx)**, **CSV/TSV**, **Text/Markdown** and **JSON** files. Columns are matched automatically, and you preview the tasks before importing |
| Import: SharePoint | Pick a SharePoint or OneDrive library synced to your PC. Every CSV, Excel and text file in it is read |
| Import: Outlook | Open tasks, flagged emails and upcoming meetings, read from the classic Outlook desktop app |
| Import: OneNote | Tagged items (To Do, Important, and so on) from recently edited pages, read from the OneNote desktop app |
| Duplicates | Importing the same source again skips tasks that were already imported |
| Data files | Every change is saved to `TaskTracker Data\tasks.json` and also exported to **`tasks.csv`** and **`tasks.xlsx`**. To find them, click **Data files** in the app |

Shortcuts: `N` creates a new task, `Ctrl+K` searches, `Esc` closes panels.

### Import formats

- **Excel/CSV**: the first row holds the headers. Recognised headers include *Task/Title/Subject, Priority, Status, Due Date/Deadline, Start Date, Owner/Assignee, Labels/Tags/Category, Account/Client/Project (→ list), Repeat/Frequency, Description, Notes*. Any other columns are added to Notes. Excel date cells and formats such as `2026-10-15`, `15/10/2026` and `Oct 15, 2026` all work.
- **Text**: one task per line. Optional hints: `!high`, `due 2026-10-15`, `due tomorrow`, `weekly`, `[x]` (done).
- See `samples/` for examples.

### Outlook / OneNote notes

- These imports use the **desktop apps** on the PC, so no Microsoft 365 sign-in or IT app registration is needed.
- The *new Outlook* app doesn't allow this, so switch to **classic Outlook** before importing.
- Outlook may ask "allow access?". Click **Allow**.

## For developers

```
python TaskTracker.pyw                 # run from source (standard library only, Python 3.9+)
python -m unittest discover -s tests   # tests
```

- `tasktracker/server.py`: local HTTP server (127.0.0.1 only) and app-window launcher
- `tasktracker/storage.py`: JSON store plus CSV/XLSX export, and repeating-task logic
- `tasktracker/importers.py`: CSV, Excel, text and JSON parsing
- `tasktracker/office.py`: Outlook and OneNote import (COM through built-in PowerShell), and SharePoint synced-folder discovery
- `tasktracker/web/`: UI (plain HTML/CSS/JS, no external libraries, works offline)
- `.github/workflows/build-exe.yml`: builds `TaskTracker.exe` with PyInstaller on Windows

Environment overrides: `TASKTRACKER_DATA` (data folder) and `TASKTRACKER_PORT`.

### Roadmap (point 7)

The app already exposes a local REST API (`/api/state`, `/api/tasks`, `/api/tasks/bulk`, `/api/import/*`). A future Microsoft 365 Copilot agent or Outlook add-in can build on it.
