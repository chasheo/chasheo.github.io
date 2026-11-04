"""Own a complete Windows process tree, including cleanup if this service dies."""
from __future__ import annotations

import ctypes
from ctypes import wintypes as w
import os
import subprocess
import time


class WindowsJobProcess:
    def __init__(self, argv: list[str], cwd: str):
        if os.name != 'nt':
            raise RuntimeError('The local game host requires Windows.')
        k = self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        size = ctypes.c_size_t

        class Basic(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                        ('flags', w.DWORD), ('min_ws', size), ('max_ws', size),
                        ('active_limit', w.DWORD), ('affinity', size),
                        ('priority', w.DWORD), ('scheduling', w.DWORD)]

        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ('r', 'w', 'o', 'rb', 'wb', 'ob')]

        class Limits(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('pm', size), ('jm', size),
                        ('peak_pm', size), ('peak_jm', size)]

        class Startup(ctypes.Structure):
            _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR),
                        ('title', w.LPWSTR), ('x', w.DWORD), ('y', w.DWORD),
                        ('xs', w.DWORD), ('ys', w.DWORD), ('xc', w.DWORD),
                        ('yc', w.DWORD), ('fill', w.DWORD), ('flags', w.DWORD),
                        ('show', w.WORD), ('reserved_size', w.WORD),
                        ('reserved2', ctypes.POINTER(w.BYTE)), ('stdin', w.HANDLE),
                        ('stdout', w.HANDLE), ('stderr', w.HANDLE)]

        class Info(ctypes.Structure):
            _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE),
                        ('pid', w.DWORD), ('tid', w.DWORD)]

        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        k.CreateJobObjectW.restype = w.HANDLE
        k.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
        k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
        k.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
        k.CloseHandle.argtypes = [w.HANDLE]
        k.ResumeThread.argtypes = [w.HANDLE]
        k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
        k.QueryInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                               w.DWORD, ctypes.c_void_p]
        k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p,
                                    w.BOOL, w.DWORD, ctypes.c_void_p, w.LPCWSTR,
                                    ctypes.POINTER(Startup), ctypes.POINTER(Info)]
        self.job = k.CreateJobObjectW(None, None)
        self.handle = None
        if not self.job:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise ctypes.WinError(ctypes.get_last_error())
        startup, info = Startup(), Info()
        startup.cb = ctypes.sizeof(startup)
        startup.flags, startup.show = 1, 0  # STARTF_USESHOWWINDOW / SW_HIDE
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline(argv))
        if not k.CreateProcessW(None, command, None, None, False, 0x4 | 0x08000000,
                                None, cwd, ctypes.byref(startup), ctypes.byref(info)):
            error = ctypes.get_last_error()
            self.close()
            raise ctypes.WinError(error)
        self.handle, self.pid = info.process, info.pid
        if not k.AssignProcessToJobObject(self.job, self.handle):
            error = ctypes.get_last_error()
            k.TerminateProcess(self.handle, 1)
            k.CloseHandle(info.thread)
            self.close()
            raise ctypes.WinError(error)
        k.ResumeThread(info.thread)
        k.CloseHandle(info.thread)

    def poll(self) -> int | None:
        code = w.DWORD()
        if not self.handle:
            return 0
        if not self.k.GetExitCodeProcess(self.handle, ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return None if code.value == 259 else code.value

    def active_count(self) -> int:
        # JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: four LARGE_INTEGER, four DWORDs.
        data = (ctypes.c_byte * 48)()
        if not self.k.QueryInformationJobObject(self.job, 1, data, 48, None):
            raise ctypes.WinError(ctypes.get_last_error())
        return w.DWORD.from_buffer(data, 40).value

    def stop(self):
        if self.job:
            if not self.k.TerminateJobObject(self.job, 0):
                raise ctypes.WinError(ctypes.get_last_error())
            deadline = time.monotonic() + 10
            while self.active_count() and time.monotonic() < deadline:
                time.sleep(0.05)
            if self.active_count():
                raise RuntimeError('Owned process tree did not exit; seat remains blocked.')
            if self.handle and self.k.WaitForSingleObject(self.handle, 10000) != 0:
                raise RuntimeError('Game exit was not signalled; seat remains blocked.')
        self.close()

    def close(self):
        if self.handle:
            self.k.CloseHandle(self.handle)
            self.handle = None
        if self.job:
            self.k.CloseHandle(self.job)
            self.job = None


class HostLock:
    """OS lock prevents a second service from launching another game."""
    def __init__(self, path):
        import msvcrt
        self.file = open(path, 'a+b')
        self.file.seek(0)
        if os.fstat(self.file.fileno()).st_size == 0:
            self.file.write(b'0')
            self.file.flush()
        self.file.seek(0)
        try:
            msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            self.file.close()
            raise RuntimeError('Another demo host already owns the single game seat.') from None

    def close(self):
        import msvcrt
        self.file.seek(0)
        msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
        self.file.close()


def current_process_receipt() -> dict:
    """Record the real interpreter, not a venv redirector parent PID."""
    from datetime import datetime, timezone
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.GetCurrentProcess.restype = w.HANDLE
    k.GetProcessTimes.argtypes = [w.HANDLE, ctypes.POINTER(w.FILETIME),
                                 ctypes.POINTER(w.FILETIME), ctypes.POINTER(w.FILETIME),
                                 ctypes.POINTER(w.FILETIME)]
    k.GetModuleFileNameW.argtypes = [w.HANDLE, w.LPWSTR, w.DWORD]
    created, ended, kernel, user = w.FILETIME(), w.FILETIME(), w.FILETIME(), w.FILETIME()
    if not k.GetProcessTimes(k.GetCurrentProcess(), ctypes.byref(created), ctypes.byref(ended),
                            ctypes.byref(kernel), ctypes.byref(user)):
        raise ctypes.WinError(ctypes.get_last_error())
    ticks = (created.dwHighDateTime << 32) + created.dwLowDateTime
    started = datetime.fromtimestamp((ticks - 116444736000000000) / 10_000_000, timezone.utc)
    executable = ctypes.create_unicode_buffer(32768)
    if not k.GetModuleFileNameW(None, executable, len(executable)):
        raise ctypes.WinError(ctypes.get_last_error())
    return {'pid': os.getpid(), 'started_utc': started.isoformat(), 'python': executable.value}
