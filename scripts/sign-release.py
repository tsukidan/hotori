"""Create locally protected signing keys and signed Hotori release manifests.

Requires Windows and Python's cryptography package. Never uploads anything.
"""
import argparse
import base64
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "assets/update-public-key.hex"
KEY = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Hotori/signing/update-key.dpapi"


class Blob(c.Structure):
    _fields_ = [("size", w.DWORD), ("data", c.POINTER(c.c_ubyte))]


def protect(data, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("The release signing key uses Windows account protection.")
    buffer = c.create_string_buffer(data)
    source = Blob(len(data), c.cast(buffer, c.POINTER(c.c_ubyte)))
    result = Blob()
    dll = c.WinDLL("crypt32", use_last_error=True)
    function = dll.CryptUnprotectData if decrypt else dll.CryptProtectData
    function.argtypes = [c.POINTER(Blob), c.c_void_p, c.c_void_p, c.c_void_p, c.c_void_p, w.DWORD, c.POINTER(Blob)]
    function.restype = w.BOOL
    if not function(c.byref(source), None, None, None, None, 1, c.byref(result)):
        raise c.WinError(c.get_last_error())
    try:
        return c.string_at(result.data, result.size)
    finally:
        kernel = c.WinDLL("kernel32")
        kernel.LocalFree.argtypes = [c.c_void_p]
        kernel.LocalFree(c.cast(result.data, c.c_void_p))


def private_key(initialize=False):
    if not KEY.exists():
        if not initialize or PUBLIC.exists():
            raise RuntimeError("Signing key is missing. Do not replace the published public key; restore the original private key.")
        key = Ed25519PrivateKey.generate()
        raw = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        KEY.parent.mkdir(parents=True, exist_ok=True)
        with KEY.open("xb") as file:
            file.write(protect(raw))
    key = Ed25519PrivateKey.from_private_bytes(protect(KEY.read_bytes(), decrypt=True))
    public = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
    if PUBLIC.exists():
        if PUBLIC.read_text().strip() != public:
            raise RuntimeError("Private key does not match the app's trusted public key.")
    elif initialize:
        PUBLIC.write_text(public + "\n", encoding="ascii")
    else:
        raise RuntimeError("Public key is missing. Run init before building.")
    return key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "sign"])
    parser.add_argument("--exe", type=Path, default=ROOT / "target/release/hotori.exe")
    parser.add_argument("--version", help="Defaults to tauri.conf.json; must match the EXE.")
    parser.add_argument("--output", type=Path, default=ROOT / "target/release")
    args = parser.parse_args()
    key = private_key(args.command == "init")
    if args.command == "init":
        print("Public verification key ready: assets/update-public-key.hex")
        print("Private signing key protected by Windows and stored outside the repository:", KEY)
        return
    version = args.version or json.loads((ROOT / "tauri.conf.json").read_text())["version"]
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", version):
        raise RuntimeError("Use a stable three-part release version.")
    binary = args.exe.read_bytes()
    if not binary.startswith(b"MZ") or not (1024 <= len(binary) <= 128 * 1024 * 1024):
        raise RuntimeError("Expected a Windows EXE between 1 KB and 128 MB.")
    # Bind the manifest to the EXE's Windows product version before signing.
    version_dll = c.WinDLL("version", use_last_error=True)
    version_dll.GetFileVersionInfoSizeW.argtypes = [w.LPCWSTR, c.POINTER(w.DWORD)]
    version_dll.GetFileVersionInfoW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p]
    version_dll.VerQueryValueW.argtypes = [c.c_void_p, w.LPCWSTR, c.POINTER(c.c_void_p), c.POINTER(w.UINT)]
    handle = w.DWORD()
    size = version_dll.GetFileVersionInfoSizeW(str(args.exe.resolve()), c.byref(handle))
    if not size:
        raise RuntimeError("EXE has no Windows version information.")
    buffer = c.create_string_buffer(size)
    if not version_dll.GetFileVersionInfoW(str(args.exe.resolve()), 0, size, buffer):
        raise c.WinError(c.get_last_error())
    pointer, length = c.c_void_p(), w.UINT()
    if not version_dll.VerQueryValueW(buffer, "\\", c.byref(pointer), c.byref(length)):
        raise RuntimeError("EXE product version is unavailable.")
    fixed = c.cast(pointer, c.POINTER(w.DWORD))
    actual = f"{fixed[4] >> 16}.{fixed[4] & 65535}.{fixed[5] >> 16}"
    if actual != version or fixed[5] & 65535:
        raise RuntimeError(f"EXE version {actual} does not match requested version {version}.")
    manifest = {"schema": 1, "version": version, "platform": "windows-x86_64", "filename": "hotori.exe", "size": len(binary), "sha256": hashlib.sha256(binary).hexdigest()}
    raw = (json.dumps(manifest, indent=2) + "\n").encode()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "hotori-update.json").write_bytes(raw)
    (args.output / "hotori-update.json.sig").write_text(base64.b64encode(key.sign(raw)).decode() + "\n", encoding="ascii")
    print(f"Signed Hotori {version}. Release assets: hotori.exe, hotori-update.json, hotori-update.json.sig")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Signing failed: {error}", file=sys.stderr)
        sys.exit(1)
