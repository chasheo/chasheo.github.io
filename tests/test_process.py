import os
from pathlib import Path
import sys
import time

import pytest
import psutil

from server.process import HostLock, WindowsJobProcess


@pytest.mark.skipif(os.name != 'nt', reason='Windows process ownership')
def test_job_owns_child_tree_and_kills_all_processes(tmp_path):
    receipt = tmp_path / 'child.pid'
    child_code = ('import os,time; from pathlib import Path; '
                  f'Path({str(receipt)!r}).write_text(str(os.getpid())); time.sleep(90)')
    code = ('import subprocess,sys,time; '
            f'subprocess.Popen([sys._base_executable,"-c",{child_code!r}]); '
            'time.sleep(90)')
    # Use the base interpreter so venv redirectors do not add extra processes.
    process = WindowsJobProcess([sys._base_executable, '-c', code], str(Path.cwd()))
    try:
        deadline = time.monotonic() + 5
        while not receipt.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        assert receipt.exists(), 'The actual child interpreter must start before cleanup is tested'
        child = psutil.Process(int(receipt.read_text()))
        # Windows may include conhost.exe in this job in addition to both interpreters.
        assert process.active_count() >= 2
        process.stop()
        assert process.poll() == 0
        child.wait(timeout=5)  # A non-child process may already have lost its exit-code handle.
        assert not child.is_running()
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
