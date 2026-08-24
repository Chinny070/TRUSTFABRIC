"""Windows compatibility for genlayer-test's stdin-backed direct runner.

The runner currently unlinks its open temporary stdin file, which is valid on
POSIX but raises WinError 32 on Windows. Keep the file until VM cleanup, then
remove it after stdin has been restored. This affects test harness setup only.
"""

import os
import tempfile

import pytest
from gltest.direct import loader


def _inject_message_to_fd0_windows(vm):
    from genlayer.py import calldata
    from genlayer.py.types import Address

    sender = Address(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
    contract = Address(vm._contract_address) if isinstance(vm._contract_address, bytes) else vm._contract_address
    origin = Address(vm.origin) if isinstance(vm.origin, bytes) else vm.origin
    encoded = calldata.encode(
        {
            "contract_address": contract,
            "sender_address": sender,
            "origin_address": origin,
            "stack": [],
            "value": vm._value,
            "datetime": vm._datetime,
            "is_init": False,
            "chain_id": vm._chain_id,
            "entry_kind": 0,
            "entry_data": b"",
            "entry_stage_data": None,
        }
    )
    fd, path = tempfile.mkstemp()
    os.write(fd, encoded)
    os.lseek(fd, 0, os.SEEK_SET)
    vm._original_stdin_fd = os.dup(0)
    os.dup2(fd, 0)
    os.close(fd)
    vm._trustfabric_stdin_path = path


@pytest.fixture(autouse=True)
def windows_direct_runner_compat(monkeypatch, direct_vm):
    if os.name != "nt":
        yield
        return

    monkeypatch.setattr(loader, "_inject_message_to_fd0", _inject_message_to_fd0_windows)
    original_cleanup = direct_vm._cleanup_after_deactivate

    def cleanup():
        original_cleanup()
        path = getattr(direct_vm, "_trustfabric_stdin_path", None)
        if path is not None:
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
            direct_vm._trustfabric_stdin_path = None

    monkeypatch.setattr(direct_vm, "_cleanup_after_deactivate", cleanup)
    yield
