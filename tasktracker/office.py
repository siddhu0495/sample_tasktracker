"""Import from the Outlook / OneNote desktop apps (Windows) via COM, driven
through the built-in PowerShell so no extra Python packages are needed.
SharePoint is read from its OneDrive-synced folder on disk."""
import json
import os
import re
import subprocess
import sys

IS_WINDOWS = sys.platform.startswith("win")

OUTLOOK_PS = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$days = __DAYS__
$out = New-Object System.Collections.ArrayList
function D($d) { if ($d -and $d.Year -lt 4000) { $d.ToString('yyyy-MM-dd') } else { '' } }
function B($s) { if ($s) { $s = ($s -replace '\r','').Trim(); if ($s.Length -gt 1500) { $s.Substring(0,1500) + '...' } else { $s } } else { '' } }
$ol = New-Object -ComObject Outlook.Application
$ns = $ol.GetNamespace('MAPI')
if (__TASKS__) {
  foreach ($t in $ns.GetDefaultFolder(13).Items) {
    if ($t.Class -ne 48 -or $t.Complete) { continue }
    [void]$out.Add(@{ kind='Outlook task'; id=$t.EntryID; title=$t.Subject; body=(B $t.Body);
      start=(D $t.StartDate); due=(D $t.DueDate); importance=$t.Importance; categories=$t.Categories; status=$t.Status })
  }
}
if (__FLAGGED__) {
  $items = $ns.GetDefaultFolder(6).Items.Restrict('[FlagStatus] = 2')
  foreach ($m in $items) {
    [void]$out.Add(@{ kind='Flagged email'; id=$m.EntryID; title=$m.Subject; body=('From: ' + $m.SenderName + "`n" + (B $m.Body));
      start=(D $m.TaskStartDate); due=(D $m.TaskDueDate); importance=$m.Importance; categories=$m.Categories; status=0 })
  }
}
if (__CALENDAR__) {
  $cal = $ns.GetDefaultFolder(9).Items
  $cal.Sort('[Start]'); $cal.IncludeRecurrences = $true
  $s = (Get-Date).Date; $e = $s.AddDays($days)
  $f = "[Start] >= '" + $s.ToString('g') + "' AND [Start] <= '" + $e.ToString('g') + "'"
  foreach ($a in $cal.Restrict($f)) {
    [void]$out.Add(@{ kind='Meeting'; id=($a.EntryID + '@' + $a.Start.ToString('yyyyMMddHHmm')); title=$a.Subject;
      body=('When: ' + $a.Start.ToString('g') + ' - ' + $a.End.ToString('t') + "`nWhere: " + $a.Location + "`nOrganizer: " + $a.Organizer);
      start=(D $a.Start); due=(D $a.Start); importance=$a.Importance; categories=$a.Categories; status=0 })
  }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
"""

ONENOTE_PS = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$days = __DAYS__
$on = New-Object -ComObject OneNote.Application
$h = ''
$on.GetHierarchy('', 4, [ref]$h)
[xml]$hx = $h
$nsm = New-Object Xml.XmlNamespaceManager($hx.NameTable)
$nsm.AddNamespace('one', $hx.DocumentElement.NamespaceURI)
$cut = (Get-Date).AddDays(-$days)
$out = New-Object System.Collections.ArrayList
foreach ($p in $hx.SelectNodes('//one:Page', $nsm)) {
  if ($p.isInRecycleBin -eq 'true') { continue }
  if ([datetime]$p.lastModifiedTime -lt $cut) { continue }
  $c = ''
  $on.GetPageContent($p.ID, [ref]$c, 0)
  [xml]$px = $c
  $pn = New-Object Xml.XmlNamespaceManager($px.NameTable)
  $pn.AddNamespace('one', $px.DocumentElement.NamespaceURI)
  $sec = $p.ParentNode.name; $nb = $p.ParentNode.ParentNode.name
  foreach ($oe in $px.SelectNodes('//one:OE[one:Tag]', $pn)) {
    $tag = $oe.SelectSingleNode('one:Tag', $pn)
    $t = $oe.SelectSingleNode('one:T', $pn)
    if (-not $t) { continue }
    $text = ($t.InnerText -replace '<[^>]+>', '').Trim()
    if (-not $text) { continue }
    [void]$out.Add(@{ id=($p.ID + '|' + $oe.objectID); title=$text; done=($tag.completed -eq 'true');
      page=$p.name; section=$sec; notebook=$nb; modified=([datetime]$p.lastModifiedTime).ToString('yyyy-MM-dd') })
  }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
"""


class OfficeError(Exception):
    pass


def _run_ps(script, timeout=180):
    if not IS_WINDOWS:
        raise OfficeError("This import works on Windows with the Office desktop app installed.")
    flags = 0x08000000  # CREATE_NO_WINDOW
    try:
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
            input=script.encode("utf-8"), capture_output=True, timeout=timeout, creationflags=flags,
        )
    except subprocess.TimeoutExpired:
        raise OfficeError("Timed out talking to Office. Try a shorter date range.")
    out = r.stdout.decode("utf-8", "ignore").strip()
    if r.returncode != 0 or not out:
        err = r.stderr.decode("utf-8", "ignore").strip().splitlines()
        msg = next((l for l in err if l.strip()), "Unknown error")
        if "80040154" in msg or "Class not registered" in msg:
            msg = "The desktop app is not installed (the 'new Outlook' does not support this - switch to classic Outlook)."
        raise OfficeError(msg[:400])
    data = json.loads(out)
    return data if isinstance(data, list) else [data]


_IMPORTANCE = {0: "low", 1: "normal", 2: "high"}


def import_outlook(days=14, tasks=True, flagged=True, calendar=True, default_list=""):
    script = (OUTLOOK_PS.replace("__DAYS__", str(int(days)))
              .replace("__TASKS__", "$true" if tasks else "$false")
              .replace("__FLAGGED__", "$true" if flagged else "$false")
              .replace("__CALENDAR__", "$true" if calendar else "$false"))
    result = []
    for it in _run_ps(script):
        status = {1: "in_progress", 3: "in_review"}.get(it.get("status"), "todo")
        result.append({
            "title": it.get("title") or "(no subject)",
            "description": it.get("body", ""),
            "start_date": it.get("start", ""),
            "due_date": it.get("due", ""),
            "priority": _IMPORTANCE.get(it.get("importance"), "normal"),
            "status": status,
            "labels": [it["kind"]] + [c.strip() for c in (it.get("categories") or "").split(",") if c.strip()],
            "list": default_list or ("Meetings" if it["kind"] == "Meeting" else ""),
            "source": "outlook",
            "source_ref": "outlook:" + it.get("id", ""),
        })
    return result, ([] if result else ["Nothing found in Outlook for the selected options."])


def import_onenote(days=30, include_done=False, default_list=""):
    result = []
    for it in _run_ps(ONENOTE_PS.replace("__DAYS__", str(int(days))), timeout=300):
        if it.get("done") and not include_done:
            continue
        result.append({
            "title": it["title"][:200],
            "description": it["title"] if len(it["title"]) > 200 else "",
            "notes": f"OneNote: {it.get('notebook')} > {it.get('section')} > {it.get('page')}",
            "status": "done" if it.get("done") else "todo",
            "labels": ["OneNote"],
            "list": default_list,
            "source": "onenote",
            "source_ref": "onenote:" + it.get("id", ""),
        })
    return result, ([] if result else [f"No tagged (To Do) items found in pages edited in the last {days} days."])


def sharepoint_folders():
    """Best-effort discovery of OneDrive / SharePoint folders synced to this PC."""
    found = []
    home = os.path.expanduser("~")
    for env in ("OneDriveCommercial", "OneDrive"):
        p = os.environ.get(env)
        if p and os.path.isdir(p) and p not in found:
            found.append(p)
    # SharePoint libraries sync to %USERPROFILE%\<Org name>\<Site - Library>
    orgs = set()
    for p in list(found):
        m = re.match(r"OneDrive - (.+)$", os.path.basename(p))
        if m:
            orgs.add(m.group(1))
    for org in orgs:
        root = os.path.join(home, org)
        if os.path.isdir(root):
            for d in sorted(os.listdir(root)):
                full = os.path.join(root, d)
                if os.path.isdir(full):
                    found.append(full)
    return found


def pick_folder():
    if not IS_WINDOWS:
        raise OfficeError("Folder picker is available on Windows. Paste the folder path instead.")
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose a SharePoint / OneDrive synced folder'
$top = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}
if ($d.ShowDialog($top) -eq 'OK') { $d.SelectedPath }
"""
    r = subprocess.run(["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
                       capture_output=True, creationflags=0x08000000)
    return r.stdout.decode("utf-8", "ignore").strip()
