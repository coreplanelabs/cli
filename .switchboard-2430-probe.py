"""Draft for one consented #2430 resident writable canary. Never run live unapproved.

Reports only a fixed status. It does not print, write, hash, or log credentials.
Use --self-test to exercise synthetic values without inspecting this machine;
that mode has a distinct output that cannot count as a live receipt.
The resident image deliberately lacks gh. The Door lookup must return the run
bearer; the public github.com lookup may have no credential at all.
Trusted image/helper/config inventory is a separate acceptance gate.
"""

from __future__ import annotations

import hmac
import os
import pwd
import re
import resource
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path


PASS = "PASS_RESIDENT_GIT_RUN_BEARER_ONLY"
APP = "FAIL_APP_BEARER"
UNKNOWN = "INDETERMINATE"
SBR = re.compile(r"sbr_([A-Za-z0-9_-]{1,64})\.[A-Za-z0-9_-]{20,128}\Z")
APP_TOKEN = re.compile(rb"ghs_[A-Za-z0-9_]{8,}")
OTHER_TOKEN = re.compile(rb"(?:ghu_|gho_|ghp_|ghr_|github_pat_|sbr_)[A-Za-z0-9_.-]{8,}")
HOST = re.compile(r"[A-Za-z0-9.-]+(?::[0-9]{1,5})?\Z")
MAX_FILE = 65_536
NO_PUBLIC_CREDENTIAL = b"fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"
NO_PUBLIC_CREDENTIAL_WITH_ASKPASS = (
    b"error: unable to read askpass response from '/bin/false'\n" + NO_PUBLIC_CREDENTIAL
)
DOOR_HELPER = (
    b'!f() { test -n "$GH_ENTERPRISE_TOKEN" || exit 1; '
    b'printf \'%s\\n\' \'username=x-access-token\' "password=$GH_ENTERPRISE_TOKEN"; }; f'
)


def kind(value: bytes, expected: bytes) -> str:
    if not value:
        return "absent"
    if hmac.compare_digest(value, expected):
        return "run"
    if APP_TOKEN.search(value):
        return "app"
    return "unknown"


def worst(current: str, observed: str) -> str:
    if current == APP or observed == "app":
        return APP
    if current == UNKNOWN or observed == "unknown":
        return UNKNOWN
    return current


def binary_status(path: str) -> str:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return "absent"
    except OSError:
        return "unknown"
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        return "unknown"
    return "trusted"


def public_credential_missing(host: str, code: int, output: bytes, errors: bytes) -> bool:
    return (
        host == "github.com"
        and code == 128
        and not output
        and errors in {NO_PUBLIC_CREDENTIAL, NO_PUBLIC_CREDENTIAL_WITH_ASKPASS}
    )


def config_contents_class(output: bytes, expected: bytes, door_host: str) -> str:
    if APP_TOKEN.search(output):
        return "app"
    if OTHER_TOKEN.search(output.replace(expected, b"")):
        return "unknown"
    door_key = f"credential.https://{door_host}.helper".encode()
    door_helpers = 0
    for entry in output.split(b"\0"):
        if not entry:
            continue
        key, separator, value = entry.partition(b"\n")
        if not separator:
            return "unknown"
        if key == b"credential.helper":
            if value:
                return "unknown"
        elif key == b"core.askpass" and value:
            return "unknown"
        elif key.startswith(b"credential.") and key.endswith(b".helper"):
            if key != door_key or value != DOOR_HELPER:
                return "unknown"
            door_helpers += 1
    return "run" if door_helpers == 1 else "unknown"


def config_class(expected: bytes, door_host: str) -> str:
    code, output, errors = command(["/usr/bin/git", "config", "--null", "--list"])
    if APP_TOKEN.search(output + errors):
        return "app"
    if code != 0 or errors:
        return "unknown"
    return config_contents_class(output, expected, door_host)


def command(argv: list[str], input_text: str | None = None) -> tuple[int, bytes, bytes]:
    if not hasattr(os, "waitid"):
        return 127, b"", b""
    env = dict(os.environ)
    env.update(
        GIT_TERMINAL_PROMPT="0",
        GCM_INTERACTIVE="never",
        GH_PROMPT_DISABLED="1",
        GIT_ASKPASS="/bin/false",
        SSH_ASKPASS="/bin/false",
    )
    try:
        process = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            start_new_session=True,
        )
    except OSError:
        return 127, b"", b""
    try:
        if process.stdin is not None:
            process.stdin.write(input_text.encode())
            process.stdin.close()
        output = bytearray()
        errors = bytearray()
        deadline = time.monotonic() + 10
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, output)
            selector.register(process.stderr, selectors.EVENT_READ, errors)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return 127, b"", b""
                for key, _ in selector.select(remaining):
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    target = key.data
                    target.extend(chunk)
                    if len(target) > MAX_FILE:
                        return 125, b"", b""
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return 127, b"", b""
            exited = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOWAIT | os.WNOHANG)
            if exited is not None and exited.si_pid == process.pid:
                code = exited.si_status if exited.si_code == os.CLD_EXITED else 127
                return code, bytes(output), bytes(errors)
            time.sleep(min(0.02, remaining))
    except (OSError, subprocess.SubprocessError):
        return 127, b"", b""
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=1)
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()


def git_password(host: str, path: str, expected: bytes) -> tuple[int, bytes, str]:
    code, output, errors = command(
        ["/usr/bin/git", "credential", "fill"],
        f"protocol=https\nhost={host}\npath={path}\n\n",
    )
    sidecar = (
        "app" if APP_TOKEN.search(errors)
        else "missing_public" if public_credential_missing(host, code, output, errors)
        else "unknown" if errors else "absent"
    )
    if APP_TOKEN.search(output) or OTHER_TOKEN.search(output.replace(expected, b"")):
        return code, output, sidecar
    fields: dict[bytes, bytes] = {}
    for line in output.splitlines():
        key, sep, value = line.partition(b"=")
        if not sep or key in fields or key not in {b"protocol", b"host", b"path", b"username", b"password"}:
            return code, output, sidecar
        fields[key] = value
    if fields.get(b"protocol", b"https") != b"https":
        return code, output, sidecar
    if fields.get(b"host", host.encode()) != host.encode():
        return code, output, sidecar
    if fields.get(b"path", path.encode()) != path.encode():
        return code, output, sidecar
    if fields.get(b"username", b"x-access-token") != b"x-access-token":
        return code, output, sidecar
    return code, fields.get(b"password", output), sidecar


def candidate_files() -> tuple[list[Path], bool]:
    identity = pwd.getpwuid(os.getuid())
    actual_home = Path(identity.pw_dir)
    paths = [
        actual_home / ".git-credentials",
        Path.home() / ".git-credentials",
        Path("/workspace/.git-credentials"),
        Path(f"/workspace/.stage-{identity.pw_name}/cred"),
    ]
    config = os.environ.get("GH_CONFIG_DIR")
    if config:
        paths.append(Path(config) / "hosts.yml")
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        paths.append(Path(xdg) / "gh/hosts.yml")
    paths.extend([actual_home / ".config/gh/hosts.yml", Path.home() / ".config/gh/hosts.yml"])
    code, output, errors = command(["/usr/bin/git", "rev-parse", "--git-dir"])
    if code != 0 or not output or errors:
        return paths, False
    gitdir = Path(os.fsdecode(output.strip()))
    if not gitdir.is_absolute():
        gitdir = Path.cwd() / gitdir
    paths.append(gitdir / "github-credentials")
    return paths, True


def file_class(path: Path, expected: bytes) -> str:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return "absent"
    except PermissionError:
        return "unknown"
    except OSError:
        return "unknown"
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE:
            return "unknown"
        data = os.read(fd, MAX_FILE + 1)
        after = os.fstat(fd)
        if (
            len(data) != info.st_size
            or after.st_size != info.st_size
            or after.st_mtime_ns != info.st_mtime_ns
            or after.st_ctime_ns != info.st_ctime_ns
        ):
            return "unknown"
    except OSError:
        return "unknown"
    finally:
        os.close(fd)
    if APP_TOKEN.search(data):
        return "app"
    if OTHER_TOKEN.search(data.replace(expected, b"")):
        return "unknown"
    if path.name == "hosts.yml":
        for line in data.splitlines():
            if b"oauth_token:" in line:
                value = line.split(b"oauth_token:", 1)[1].strip().strip(b"\"'")
                if not hmac.compare_digest(value, expected):
                    return "unknown"
    elif data:
        lines = data.splitlines()
        if len(lines) != 1:
            return "unknown"
        allowed = b"https://x-access-token:" + expected + b"@"
        if not lines[0].startswith(allowed) or not HOST.fullmatch(os.fsdecode(lines[0][len(allowed) :])):
            return "unknown"
    return "run" if expected in data else "absent"


def credential_result(code: int, password: bytes, sidecar: str, expected: bytes, allow_missing: bool = False) -> str:
    observed = kind(password, expected)
    result = worst(PASS, sidecar)
    if allow_missing and code == 128 and observed == "absent" and sidecar == "missing_public":
        return PASS
    if code != 0 or observed == "absent":
        return worst(result, "app" if observed == "app" else "unknown")
    return worst(result, observed)


def probe() -> str:
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (OSError, ValueError):
        return UNKNOWN
    run_id = os.environ.get("SWITCHBOARD_RUN_ID", "")
    repo = os.environ.get("SB_CANARY_REPO", "")
    backend = os.environ.get("SB_EXPECTED_BACKEND", "")
    expected_door_host = os.environ.get("SB_EXPECTED_DOOR_HOST", "")
    door_host = os.environ.get("GH_HOST", "")
    bearer = os.environ.get("GH_ENTERPRISE_TOKEN", "")
    harness_bearer = os.environ.get("SWITCHBOARD_RUN_BEARER", "")
    bearer_match = SBR.fullmatch(bearer)
    if (
        not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", run_id)
        or repo != "coreplanelabs/cli"
        or backend != "resident"
        or not HOST.fullmatch(door_host)
        or door_host != expected_door_host
        or door_host == "github.com"
        or not bearer_match
        or run_id != bearer_match.group(1)
        or not hmac.compare_digest(bearer, harness_bearer)
    ):
        return UNKNOWN
    expected = bearer.encode()
    result = PASS
    if binary_status("/usr/bin/git") != "trusted":
        return UNKNOWN
    for name, value in os.environ.items():
        if name == "GH_ENTERPRISE_TOKEN":
            continue
        raw = value.encode(errors="surrogateescape")
        if APP_TOKEN.search(raw):
            return APP
        if name in {"GH_TOKEN", "GITHUB_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GITHUB_APP_PRIVATE_KEY", "SWITCHBOARD_GIT_CREDENTIAL"} and value:
            result = UNKNOWN
        if name in {"GIT_ASKPASS", "SSH_ASKPASS"} and value:
            result = UNKNOWN
        if OTHER_TOKEN.search(raw.replace(expected, b"")):
            result = UNKNOWN
    result = worst(result, config_class(expected, door_host))
    paths, gitdir_known = candidate_files()
    if not gitdir_known:
        result = UNKNOWN
    for path in paths:
        result = worst(result, file_class(path, expected))
    for host, path in [
        ("github.com", f"{repo}.git"),
        (door_host, f"git/{repo}.git"),
    ]:
        code, password, sidecar = git_password(host, path, expected)
        classified = credential_result(code, password, sidecar, expected, allow_missing=host == "github.com")
        result = APP if classified == APP else worst(result, "unknown" if classified == UNKNOWN else "run")
    return result


def self_test() -> str:
    fake = b"sbr_test.abcdefghijklmnopqrstuvwxyz123456"
    if kind(fake, fake) != "run":
        return UNKNOWN
    if kind(b"ghs_exampletoken12345678", fake) != "app":
        return UNKNOWN
    if kind(b"ghp_othertoken12345678", fake) != "unknown":
        return UNKNOWN
    if worst(PASS, "app") != APP or worst(PASS, "unknown") != UNKNOWN:
        return UNKNOWN
    if credential_result(1, fake, "absent", fake) != UNKNOWN:
        return UNKNOWN
    if credential_result(0, fake, "absent", fake) != PASS:
        return UNKNOWN
    if credential_result(1, b"ghs_exampletoken12345678", "absent", fake) != APP:
        return UNKNOWN
    if credential_result(1, b"", "absent", fake) != UNKNOWN:
        return UNKNOWN
    if credential_result(0, b"", "absent", fake) != UNKNOWN:
        return UNKNOWN
    if credential_result(0, fake, "unknown", fake) != UNKNOWN:
        return UNKNOWN
    if credential_result(0, fake, "app", fake) != APP:
        return UNKNOWN
    if credential_result(128, b"", "missing_public", fake, allow_missing=True) != PASS:
        return UNKNOWN
    if credential_result(128, b"", "missing_public", fake) != UNKNOWN:
        return UNKNOWN
    if credential_result(128, b"ghs_exampletoken12345678", "app", fake, allow_missing=True) != APP:
        return UNKNOWN
    if not public_credential_missing("github.com", 128, b"", NO_PUBLIC_CREDENTIAL_WITH_ASKPASS):
        return UNKNOWN
    if public_credential_missing("github.com", 128, b"", b"fatal: other error\n"):
        return UNKNOWN
    good_config = b"credential.helper\n\0credential.https://git.example.helper\n" + DOOR_HELPER + b"\0"
    if config_contents_class(good_config, fake, "git.example") != "run":
        return UNKNOWN
    if config_contents_class(good_config + b"credential.https://github.com.helper\n!echo unknown\0", fake, "git.example") != "unknown":
        return UNKNOWN
    if config_contents_class(good_config + b"credential.helper\n!echo unknown\0", fake, "git.example") != "unknown":
        return UNKNOWN
    if config_contents_class(good_config + b"credential.helper\nghs_exampletoken12345678\0", fake, "git.example") != "app":
        return UNKNOWN
    if config_contents_class(good_config + b"core.askpass\n/bin/some-helper\0", fake, "git.example") != "unknown":
        return UNKNOWN
    with tempfile.TemporaryDirectory(prefix="sb2430-synthetic-") as directory:
        store = Path(directory) / "github-credentials"
        store.write_bytes(b"https://x-access-token:" + fake + b"@github.com\n")
        if file_class(store, fake) != "run":
            return UNKNOWN
        store.write_bytes(b"https://x-access-token:ghs_exampletoken12345678@github.com\n")
        if file_class(store, fake) != "app":
            return UNKNOWN
        store.write_bytes(b"https://x-access-token:opaque12345678@github.com\n")
        if file_class(store, fake) != "unknown":
            return UNKNOWN
        hosts = Path(directory) / "hosts.yml"
        hosts.write_bytes(b"git.example:\n  oauth_token: " + fake + b"\n")
        if file_class(hosts, fake) != "run":
            return UNKNOWN
        hosts.write_bytes(b"git.example:\n  oauth_token: opaque12345678\n")
        if file_class(hosts, fake) != "unknown":
            return UNKNOWN
    return PASS


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            answer = "SYNTHETIC_SELF_TEST_PASS" if self_test() == PASS else UNKNOWN
        elif sys.argv[1:]:
            answer = UNKNOWN
        else:
            answer = probe()
    except BaseException:
        answer = UNKNOWN
    sys.stdout.write(answer + "\n")
