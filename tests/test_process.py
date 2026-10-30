import os
from pathlib import Path
import sys
import time

import pytest

from server.process import HostLock, WindowsJobProcess


@pytest.mark.skipif(os.name != 'nt', reason='Windows process ownership')
def test_job_owns_child_tree_and_kills_all_processes():
    code = ('import subprocess,sys,time; '
            'subprocess.Popen([sys._base_executable,"-c","import time; time.sleep(90)"]); '
            'time.sleep(90)')
    # Use the base interpreter so venv redirectors do not add extra processes.
    process = WindowsJobProcess([sys._base_executable, '-c', code], str(Path.cwd()))
    try:
        deadline = time.monotonic() + 5
        while process.active_count() < 2 and time.monotonic() < deadline:
            time.sleep(0.05)
        assert process.active_count() == 2
        process.stop()
        assert process.poll() == 0
    finally:
        process.close()


@pytest.mark.skipif(os.name != 'nt', reason='Windows process ownership')
def test_second_host_is_rejected_and_lock_can_be_reacquired(tmp_path):
    first = HostLock(tmp_path / 'seat.lock')
    try:
        with pytest.raises(RuntimeError, match='Another demo host'):
            HostLock(tmp_path / 'seat.lock')
    finally:
        first.close()
    third = HostLock(tmp_path / 'seat.lock')
    third.close()
