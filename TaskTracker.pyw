"""Daily Task Tracker - double-click to start (opens as an app window)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tasktracker.server import main  # noqa: E402

if __name__ == "__main__":
    main(open_ui="--no-window" not in sys.argv)
