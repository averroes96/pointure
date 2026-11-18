"""
Fail the Windows build when a compiled module of the bundled Python needs a DLL a shop PC may not have.

    python check_dll_imports.py <python-dist> --arch x64|ia32

Why: the build machine (GitHub's windows-latest) has the Visual C++ runtime installed system-wide, so
importing everything there proves nothing about a clean PC. One store's OCR failed with
"DLL load failed while importing _multiarray_umath": 32-bit NumPy needs MSVCP140.dll, which neither the
embeddable Python nor the wheel ships (onnxruntime and pyclipper need it on x64 too).

What it does: reads the import table of every .pyd / .dll under <python-dist> and checks that each imported
DLL is either part of Windows itself or present where the loader looks for an extension's dependencies:
the folder of python.exe, the importing file's own folder, or a wheel's "<name>.libs" folder (delvewheel
adds it with os.add_dll_directory). It also checks every binary matches the target architecture. Delay-
loaded DLLs are not checked: they are optional by design. Pure Python, no third-party package needed.

Exit status 0 when everything resolves, 1 with the list of missing DLLs and who needs them otherwise.
"""
import argparse
import re
import struct
import sys
from pathlib import Path

MACHINES = {"x64": 0x8664, "ia32": 0x014C}

# API sets and DLLs that are part of Windows 10/11 itself (never shipped by an application).
WINDOWS_API_SET = re.compile(r"^(api-ms-win-|ext-ms-)", re.IGNORECASE)
WINDOWS_DLLS = {
    name.lower() for name in """
    advapi32 bcrypt bcryptprimitives cabinet cfgmgr32 comctl32 comdlg32 crypt32 cryptbase d3d11 d3d12 d3dcompiler_47
    dbghelp dnsapi dwmapi dxgi dxcore gdi32 gdiplus imagehlp imm32 iphlpapi kernel32 kernelbase mf mfplat
    mfreadwrite mpr msi msimg32 msvcrt mswsock ncrypt netapi32 normaliz ntdll ole32 oleacc oleaut32 opengl32
    glu32 powrprof propsys psapi rpcrt4 secur32 setupapi shcore shell32 shlwapi sspicli ucrtbase user32
    userenv usp10 uxtheme version winhttp wininet winmm winspool.drv wintrust wldap32 ws2_32 wtsapi32
    """.split()
}


class NotPE(ValueError):
    pass


def _section_offset(sections, rva):
    for virtual_address, virtual_size, raw_size, raw_pointer in sections:
        if virtual_address <= rva < virtual_address + max(virtual_size, raw_size):
            return raw_pointer + (rva - virtual_address)
    raise NotPE(f"RVA {rva:#x} is outside every section")


def _c_string(data, offset):
    end = data.index(b"\0", offset)
    return data[offset:end].decode("ascii", "replace")


def read_pe(data: bytes):
    """(machine, [imported DLL names]) of a PE file (PE32 or PE32+)."""
    if data[:2] != b"MZ":
        raise NotPE("no MZ header")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise NotPE("no PE signature")
    machine, section_count = struct.unpack_from("<HH", data, pe + 4)
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    if magic == 0x10B:          # PE32
        rva_count_at, directories_at = optional + 92, optional + 96
    elif magic == 0x20B:        # PE32+
        rva_count_at, directories_at = optional + 108, optional + 112
    else:
        raise NotPE(f"unknown optional header magic {magic:#x}")

    sections = []
    table = optional + optional_size
    for index in range(section_count):
        virtual_size, virtual_address, raw_size, raw_pointer = struct.unpack_from("<IIII", data, table + 40 * index + 8)
        sections.append((virtual_address, virtual_size, raw_size, raw_pointer))

    if struct.unpack_from("<I", data, rva_count_at)[0] < 2:
        return machine, []
    import_rva, import_size = struct.unpack_from("<II", data, directories_at + 8)      # data directory 1
    if not import_rva or not import_size:
        return machine, []

    names = []
    descriptor = _section_offset(sections, import_rva)
    while True:
        lookup, _stamp, _forwarder, name_rva, first_thunk = struct.unpack_from("<IIIII", data, descriptor)
        if not (lookup or name_rva or first_thunk):
            break
        names.append(_c_string(data, _section_offset(sections, name_rva)))
        descriptor += 20
    return machine, names


def is_windows_dll(name: str) -> bool:
    lowered = name.lower()
    return bool(WINDOWS_API_SET.match(lowered)) or lowered.removesuffix(".dll") in WINDOWS_DLLS


def check(dist: Path, arch: str):
    """({missing DLL: [importers]}, [binaries built for another architecture], [unreadable files])."""
    binaries = sorted(p for p in dist.rglob("*") if p.is_file() and p.suffix.lower() in (".pyd", ".dll"))
    root = {p.name.lower() for p in dist.iterdir() if p.is_file()}
    libs_dirs = {p.name.lower() for d in dist.rglob("*.libs") if d.is_dir() for p in d.iterdir() if p.is_file()}

    missing, wrong_arch, unreadable = {}, [], []
    for binary in binaries:
        try:
            machine, imports = read_pe(binary.read_bytes())
        except (NotPE, struct.error, ValueError) as error:
            unreadable.append(f"{binary.relative_to(dist)} ({error})")
            continue
        if machine != MACHINES[arch]:
            wrong_arch.append(f"{binary.relative_to(dist)} (machine {machine:#06x})")
        beside = {p.name.lower() for p in binary.parent.iterdir() if p.is_file()}
        for name in imports:
            lowered = name.lower()
            if is_windows_dll(name) or lowered in root or lowered in beside or lowered in libs_dirs:
                continue
            missing.setdefault(name, []).append(str(binary.relative_to(dist)))
    return missing, wrong_arch, unreadable


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1].strip())
    parser.add_argument("dist", type=Path, help="the bundled Python folder (python-dist)")
    parser.add_argument("--arch", choices=sorted(MACHINES), required=True)
    args = parser.parse_args(argv)

    missing, wrong_arch, unreadable = check(args.dist, args.arch)
    for line in unreadable:
        print(f"warning: not a readable PE file: {line}")
    if wrong_arch:
        print(f"ERROR: binaries not built for {args.arch}:")
        for line in wrong_arch:
            print(f"  {line}")
    if missing:
        print("ERROR: DLLs that a clean Windows PC does not have and the bundle does not ship:")
        for name, importers in sorted(missing.items(), key=lambda item: item[0].lower()):
            shown = ", ".join(importers[:3]) + (f" (+{len(importers) - 3} more)" if len(importers) > 3 else "")
            print(f"  {name}  <- {shown}")
    if missing or wrong_arch:
        return 1
    print(f"DLL check passed: every import of the {args.arch} bundle resolves on a clean Windows PC.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
