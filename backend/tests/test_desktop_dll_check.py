"""
desktop/scripts/check_dll_imports.py: the Windows build fails when a bundled binary needs a DLL that a
clean PC lacks (the store's OCR broke on MSVCP140.dll, which the build machine had system-wide).

The PE files here are synthetic (built below) so the tests run anywhere, with no Windows binaries.
"""
import importlib.util
import struct
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "desktop" / "scripts" / "check_dll_imports.py"
pytestmark = pytest.mark.skipif(not SCRIPT.is_file(), reason="desktop scripts are not next to the backend")

X64, X86 = 0x8664, 0x014C


@pytest.fixture(scope="module")
def checker():
    spec = importlib.util.spec_from_file_location("check_dll_imports", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_pe(imports, machine=X64, plus=True):
    """A minimal PE file whose import table lists `imports` (PE32+ for 64-bit, PE32 otherwise)."""
    e_lfanew, raw, va = 0x40, 0x200, 0x1000
    optional_size = (112 if plus else 96) + 16 * 8
    section_table = e_lfanew + 24 + optional_size

    descriptors_size = 20 * (len(imports) + 1)
    names, name_rvas = b"", []
    for name in imports:
        name_rvas.append(va + descriptors_size + len(names))
        names += name.encode("ascii") + b"\0"
    descriptors = b"".join(struct.pack("<IIIII", 0, 0, 0, rva, 1) for rva in name_rvas) + b"\0" * 20
    section = descriptors + names

    data = bytearray(raw + len(section))
    data[0:2] = b"MZ"
    struct.pack_into("<I", data, 0x3C, e_lfanew)
    data[e_lfanew:e_lfanew + 4] = b"PE\0\0"
    struct.pack_into("<HHIIIHH", data, e_lfanew + 4, machine, 1, 0, 0, 0, optional_size, 0x2022)
    optional = e_lfanew + 24
    struct.pack_into("<H", data, optional, 0x20B if plus else 0x10B)
    struct.pack_into("<I", data, optional + (108 if plus else 92), 16)                    # NumberOfRvaAndSizes
    struct.pack_into("<II", data, optional + (112 if plus else 96) + 8, va, len(descriptors))   # import directory
    struct.pack_into("<8sIIII", data, section_table, b".idata", len(section), va, len(section), raw)
    data[raw:] = section
    return bytes(data)


def write(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


@pytest.fixture
def bundle(tmp_path):
    """The embeddable Python layout: python.exe, python312.dll and vcruntime140.dll at the root."""
    write(tmp_path / "python.exe", make_pe(["KERNEL32.dll", "python312.dll"]))
    write(tmp_path / "python312.dll", make_pe(["KERNEL32.dll", "VCRUNTIME140.dll", "api-ms-win-crt-runtime-l1-1-0.dll"]))
    write(tmp_path / "vcruntime140.dll", make_pe(["KERNEL32.dll"]))
    write(tmp_path / "vcruntime140_1.dll", make_pe(["KERNEL32.dll"]))
    return tmp_path


NUMPY_CORE = "Lib/site-packages/numpy/_core/_multiarray_umath.cp312-win_amd64.pyd"


# ─── PE reading ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("machine,plus", [(X64, True), (X86, False)])
def test_imports_are_read_from_pe32_and_pe32_plus(checker, machine, plus):
    imports = ["KERNEL32.dll", "MSVCP140.dll", "api-ms-win-crt-heap-l1-1-0.dll", "python312.dll"]
    assert checker.read_pe(make_pe(imports, machine, plus)) == (machine, imports)


def test_a_file_without_imports_has_none(checker):
    assert checker.read_pe(make_pe([])) == (X64, [])


@pytest.mark.parametrize("content", [b"", b"MZ" + b"\0" * 10, b"not a dll at all" * 10])
def test_a_file_that_is_not_pe_is_rejected(checker, content):
    with pytest.raises((checker.NotPE, struct.error)):
        checker.read_pe(content)


def test_windows_own_dlls_are_recognised(checker):
    for name in ("KERNEL32.dll", "kernel32.DLL", "api-ms-win-crt-math-l1-1-0.dll", "ext-ms-win-ntuser-l1-1-0.dll",
                 "bcrypt.dll", "Cabinet.dll", "msi.dll"):
        assert checker.is_windows_dll(name), name
    for name in ("MSVCP140.dll", "MSVCP140_1.dll", "VCRUNTIME140.dll", "python312.dll", "libssl-3.dll"):
        assert not checker.is_windows_dll(name), name


# ─── Resolution in a bundle ───────────────────────────────────────────────────

def test_the_store_failure_is_caught_msvcp140_is_neither_windows_nor_bundled(checker, bundle):
    write(bundle / NUMPY_CORE, make_pe(["KERNEL32.dll", "VCRUNTIME140.dll", "MSVCP140.dll", "python312.dll"]))
    missing, wrong_arch, unreadable = checker.check(bundle, "x64")
    assert missing == {"MSVCP140.dll": [NUMPY_CORE]}
    assert wrong_arch == [] and unreadable == []


def test_a_dll_next_to_python_exe_resolves_for_every_package(checker, bundle):
    write(bundle / NUMPY_CORE, make_pe(["MSVCP140.dll"]))
    write(bundle / "Lib/site-packages/onnxruntime/capi/onnxruntime.dll", make_pe(["msvcp140.dll", "MSVCP140_1.dll"]))
    write(bundle / "msvcp140.dll", make_pe(["KERNEL32.dll", "VCRUNTIME140.dll"]))
    write(bundle / "msvcp140_1.dll", make_pe(["KERNEL32.dll"]))
    assert checker.check(bundle, "x64") == ({}, [], [])


def test_a_dll_beside_the_importer_or_in_a_wheel_libs_folder_resolves(checker, bundle):
    write(bundle / "Lib/site-packages/onnxruntime/capi/onnxruntime_pybind11_state.pyd", make_pe(["onnxruntime.dll"]))
    write(bundle / "Lib/site-packages/onnxruntime/capi/onnxruntime.dll", make_pe(["KERNEL32.dll"]))
    write(bundle / NUMPY_CORE, make_pe(["libscipy_openblas64_-ed4f.dll", "msvcp140-a4c2.dll"]))
    write(bundle / "Lib/site-packages/numpy.libs/libscipy_openblas64_-ed4f.dll", make_pe(["KERNEL32.dll"]))
    write(bundle / "Lib/site-packages/numpy.libs/msvcp140-a4c2.dll", make_pe(["VCRUNTIME140.dll"]))
    assert checker.check(bundle, "x64") == ({}, [], [])


def test_binaries_of_the_other_architecture_are_reported(checker, bundle):
    write(bundle / "Lib/site-packages/PIL/_imaging.cp312-win32.pyd", make_pe(["KERNEL32.dll"], X86, plus=False))
    missing, wrong_arch, _ = checker.check(bundle, "x64")
    assert missing == {}
    assert wrong_arch == ["Lib/site-packages/PIL/_imaging.cp312-win32.pyd (machine 0x014c)"]


def test_an_unreadable_file_is_a_warning_not_a_crash(checker, bundle):
    write(bundle / "Lib/site-packages/odd/data.dll", b"this is not a DLL")
    missing, wrong_arch, unreadable = checker.check(bundle, "x64")
    assert (missing, wrong_arch) == ({}, [])
    assert len(unreadable) == 1 and unreadable[0].startswith("Lib/site-packages/odd/data.dll")


# ─── Command line ─────────────────────────────────────────────────────────────

def test_the_command_fails_the_build_and_names_the_missing_dll(checker, bundle, capsys):
    write(bundle / NUMPY_CORE, make_pe(["MSVCP140.dll"]))
    assert checker.main([str(bundle), "--arch", "x64"]) == 1
    out = capsys.readouterr().out
    assert "MSVCP140.dll  <- " + NUMPY_CORE in out


def test_the_command_passes_a_complete_bundle(checker, bundle, capsys):
    write(bundle / NUMPY_CORE, make_pe(["MSVCP140.dll"]))
    write(bundle / "msvcp140.dll", make_pe(["KERNEL32.dll"]))
    assert checker.main([str(bundle), "--arch", "x64"]) == 0
    assert "DLL check passed" in capsys.readouterr().out


def test_the_command_rejects_a_bundle_built_for_the_other_architecture(checker, bundle, capsys):
    assert checker.main([str(bundle), "--arch", "ia32"]) == 1
    assert "binaries not built for ia32" in capsys.readouterr().out
