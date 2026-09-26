import os
import re
import threading
import time
import socket
import random
import pexpect
import hashlib
import paramiko
import subprocess as sp
import shutil
from pathlib import Path
import tempfile
import traceback
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed, wait
from typing import Callable, Generator, Tuple, Union, Any, Literal, TypeAlias, get_args
from types import MappingProxyType

__CG_VENDOR_MAP__ = MappingProxyType({
    "ea": "SDC",
    "9a": "LGD",
    "9b": "LGD",
    "64": "BOE",
    "65": "BOE",
})

CmdTool: TypeAlias = Literal[
    "halt",
    "reboot",
    "os_app",
    "diags",
    "iboot",
    "renew_units",
]

__CMD_MAP__ = MappingProxyType({
    "os_app": (
        "killall -9 colortest",
        "killall -9 luacore",
        "SignageTool close",
        "OSDToolbox appswitch -s Default"
    ),
    "diags": ("nvram auto-boot=true", "nvram boot-command=diags", "reboot"),
    "iboot": ("nvram auto-boot=false", "reboot"),
    "renew_units": (
        "rm -rf /var/root/results",
        "rm -rf /var/root/project_files"
        "rm *.log *.csv *.txt *.tgz *.sh *.py *.ini *.json *.jpg *.dd *raw *meta *.plist",
        "rm -rf /var/mobile/Media/FactoryLogs/LogCollector/RcamCoexA149",
        "rm -rf /var/mobile/Media/FactoryLogs/LogCollector/Astro*",
        "rm -rf /var/mobile/Media/FactoryLogs/LogCollector/SystemCoex",
        "rm -rf /var/mobile/Media/FactoryLogs/LogCollector/MMI",
        "rm -rf /var/mobile/Media/FactoryLogs/LogCollector/Wingsuit",
        "diagstool bootargs -r serial-device=0x00000083",
        "diagstool bootargs -r astro",
        "powerswitch lcd on",
        "killall -9 luacore",
        "SignageTool set -text 'renew complete' -textSize 100 -textColor black -backgroundColor white",
    )
})

__STATIC_COMMAND__ = {
    "sw_version": {
        "cmd": "sw_vers --buildVersion",
    }, "serial_number": {
        "cmd": "gestalt_query SerialNumber",
        "pattern": r'SerialNumber:\s*"([^"]+)"',
    }, "battery": {
        "cmd": "smcif -kd BRSC",
    }, "temperature": {
        "cmd": "smcif -kd TG0V",
    }, "llm_packs": {
        "cmd": "darwinup list",
        "pattern": r"^LLM.*\.tar\.gz$"
    }, "data_size_str": {
        "cmd": "du -h -d=1 results"
    }, "configs": {
        "cmd": "sysconfig read -r -k 'CFG#'"
    }, "vendor_str": {
        "cmd": "powerswitch lcd on ; "
               "displayPort -edp -auxFilter 0 ; "
               "displayPort -edp -wdpcd 0x4e0 2 0xb1 0x00 ; "
               "displayPort -edp -rdpcd 0x4f1 1 | cut -d ' ' -f 2"
    }
}

__DYNAMIC_COMMAND__ = {
    "battery": {
        "cmd": "smcif -kd BRSC",
    }, "temperature": {
        "cmd": "smcif -kd TG0V",
    }, "data_size_str": {
        "cmd": "du -h -d=1 results"
    }
}

__SSH_ERR_MSGS__ = MappingProxyType({
    1: "SSH Error: Permission denied",
    2: "SSH Error: Connection reset by peer",
    3: "SSH Error: EOF",
    4: "SSH Error: Timeout"
})

__SSH_PATTERNS__ = [
    r'iPhone:~ .+#',
    r'Permission denied',
    r"Connection reset by peer",
    pexpect.EOF,
    pexpect.TIMEOUT,
]


def get_tool_list() -> list:
    return list(get_args(CmdTool))


def safe_get(lst: list, index: int, default=None) -> Any:
    return lst[index] if 0 <= abs(index) < len(lst) else default


def is_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('0.0.0.0', port))
            return True
        except socket.error as _e:
            return False


def check_ssh_connection(hostname, port=22, timeout=0.5):
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((hostname, port))
        sock.close()
        if result == 0:
            return True
        else:
            return False
    except socket.error as _e:
        return False


def random_port(debug: bool = False, try_count: int = 1000) -> int:
    if not debug:
        for _ in range(try_count):
            port = random.randint(10000, 30000)
            if is_port_available(port):
                return port
    return 5000


def file_hash(file_path: Path | str, hash_algorithm: Literal["sha256", "sha384", "sha512"] = "sha256") -> str:
    if isinstance(file_path, str) and not os.path.exists(file_path):
        return ""
    elif isinstance(file_path, Path) and not file_path.exists():
        return ""
    hash_func = getattr(hashlib, hash_algorithm)()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            hash_func.update(chunk)
    return hash_func.hexdigest()


def are_files_equal(file1: Path | str, file2: Path | str) -> bool:
    return file_hash(file1) == file_hash(file2)


def gen_ssh_key(force: bool = False) -> Path:
    saved_key_path = Path().home().joinpath("Library/Caches/com.apple.sear.esc")
    temp_path = Path(tempfile.mkdtemp())
    ssh_path = temp_path.joinpath('.ssh')
    public_key = ssh_path.joinpath('id_ecdsa.pub')
    authorized_keys = ssh_path.joinpath('authorized_keys')
    if not ssh_path.exists() or force:
        ssh_path.mkdir(parents=True, exist_ok=True)
        ssh_path.chmod(0o700)
        if saved_key_path.exists():
            if not are_files_equal(saved_key_path / "id_ecdsa", ssh_path / "id_ecdsa") or force:
                shutil.copy2(str(saved_key_path / "id_ecdsa"), str(ssh_path / "id_ecdsa"))
                shutil.copy2(str(saved_key_path / "id_ecdsa.pub"), str(ssh_path / "id_ecdsa.pub"))
        else:
            command = [
                "ssh-keygen",
                "-P", "",
                "-f", f"{ssh_path}/id_ecdsa",
                "-t", "ecdsa",
                "-b", "521",
                "-C", "local@mac",
                "-q"
            ]
            sp.run(command, check=True, stdout=sp.DEVNULL, stderr=sp.DEVNULL)
    shutil.copy2(str(public_key), str(authorized_keys))
    return ssh_path


class Detector:
    def __init__(self):
        self.__processing__ = None
        self.__running__ = True
        self.__ecids__ = {}
        self.__process_dict__ = {}
        self.__detail_info__ = {}
        self.__ssh_path__ = gen_ssh_key()
        self.__process_external_data_thread__ = None
        self.__detail_lock__ = threading.Lock()
        self.__executor__ = ThreadPoolExecutor(max_workers=16)
        self.__cleanup_lock__ = threading.Lock()
        self.__cleanup_running__ = False
        self.__lifetime_ttl__ = 5.0
        self.__lifetime_last_run__ = 0.0

    def __detector__(self) -> None:
        __remove_ecids__ = []
        while self.__running__:
            time.sleep(0.2)
            try:
                with sp.Popen(
                        ["usbterm", "-list"],
                        stdout=sp.PIPE,
                        stderr=sp.PIPE,
                        text=True
                ) as proc:
                    stdout, stderr = proc.communicate()
                    if proc.returncode:
                        proc.stdout.close()
                        proc.stderr.close()
                        proc.kill()
                        continue
                    out_str = stdout.strip()
                    lines = out_str.splitlines()
                    __remove_ecids__.clear()

                    for line in lines:
                        line_split = [s.replace(',', '') for s in line.split()]
                        if len(line_split) > 3:
                            location_id = safe_get(line_split, 2, "").strip()
                            ser_ecid = safe_get(line_split, 3, "").strip()
                            self.__ecids__[ser_ecid.strip()[8:24]] = {}
                            self.__ecids__[ser_ecid.strip()[8:24]]["ser"] = ser_ecid.strip()[:8]
                            self.__ecids__[ser_ecid.strip()[8:24]]["loc"] = location_id

                    for ecid in self.__ecids__.keys():
                        if ecid not in out_str:
                            __remove_ecids__.append(ecid)

                    for remove_ecid in __remove_ecids__:
                        self.__ecids__.pop(remove_ecid, None)

                    proc.stdout.close()
                    proc.stderr.close()
                    proc.kill()
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"An error occurred: {e}")
                traceback.print_exc()
                break

    def start(self) -> None:
        threading.Thread(target=self.__detector__).start()

    def stop(self) -> None:
        for ecid, data in self.__process_dict__.items():
            tcprelay = data.get("tcprelay", None)
            if isinstance(tcprelay, sp.Popen):
                tcprelay.terminate()
        self.__processing__ = None
        self.__running__ = False
        self.__executor__.shutdown(wait=False)

    def get_ecids(self, full: bool = False) -> dict | list:
        data = {} if full else []
        if self.__running__:
            if full:
                data = {k: v for k, v in self.__ecids__.items() if k and v}
            else:
                data = [k for k in self.__ecids__.keys() if k]
        return data

    def __process_dict_lifetime__(self) -> None:
        ecids = self.get_ecids()
        removable_info_ecids = [ecid for ecid in self.__process_dict__ if ecid not in ecids]
        check_items = [
            (ecid, data.get("port"))
            for ecid, data in self.__process_dict__.items()
            if data.get("port") is not None
        ]
        removable_process_ecids = []
        if check_items:
            with ThreadPoolExecutor(max_workers=16) as executor:
                futures = {
                    executor.submit(check_ssh_connection, "127.0.0.1", port): ecid
                    for ecid, port in check_items
                }
                for future in as_completed(futures):
                    if not future.result():
                        removable_process_ecids.append(futures[future])
        for ecid in removable_process_ecids:
            data = self.__process_dict__.pop(ecid, None)
            if data:
                ssh = data.get("ssh", None)
                if ssh:
                    try:
                        ssh.close()
                    except Exception:
                        pass
                tcprelay = data.get("tcprelay", None)
                if isinstance(tcprelay, sp.Popen):
                    try:
                        tcprelay.terminate()
                    except Exception:
                        pass
                    self.__wait_process__(tcprelay, timeout=3)
        for ecid in removable_info_ecids:
            self.__detail_info__.pop(ecid, None)

    def __schedule_cleanup__(self) -> None:
        with self.__cleanup_lock__:
            if self.__cleanup_running__:
                return
            self.__cleanup_running__ = True

        def _run():
            try:
                self.__lifetime_last_run__ = time.monotonic()
                self.__process_dict_lifetime__()
            except Exception as e:
                print(f"Cleanup failed: {e}")
            finally:
                with self.__cleanup_lock__:
                    self.__cleanup_running__ = False

        threading.Thread(target=_run, daemon=True).start()

    @staticmethod
    def __run_cmd__(cmd: list[str]) -> sp.Popen:
        process = sp.Popen(
            cmd,
            stdin=sp.PIPE,
            stdout=sp.PIPE,
            stderr=sp.PIPE,
            text=True
        )
        return process

    @staticmethod
    def __wait_process__(process: sp.Popen, timeout: float | None = None) -> Tuple[str, str]:
        try:
            return process.communicate(timeout=timeout)
        except sp.TimeoutExpired:
            process.kill()
            return process.communicate()

    def __gen_conn__(self, allowed_ser_ecids: dict) -> None:
        for ecid, data in allowed_ser_ecids.items():
            serialnumber = data["ser"] + '-' + ecid
            location_id = data["loc"]
            if not self.__process_dict__.get(ecid, None):
                self.__process_dict__[ecid] = {}
                copy_process = self.__run_cmd__(
                    ["copyUnrestricted", "-w", "-u", location_id, "-s", str(self.__ssh_path__), "-t", "/var/root"])
                self.__wait_process__(copy_process, timeout=30)
                if not self.__process_dict__.get(ecid, {}).get("tcprelay", None):
                    port = random_port()
                    self.__process_dict__[ecid]["tcprelay"] = self.__run_cmd__(
                        ['tcprelay', '--serialnumber', serialnumber,
                         '--portoffset', f'{port - 22}', '22',
                         '--autoexit', '--quiet'])
                    self.__process_dict__[ecid]["port"] = port

    @staticmethod
    def __is_ssh_alive__(ssh) -> bool:
        if ssh is None:
            return False
        transport = ssh.get_transport()
        return transport is not None and transport.is_active()

    def __remote_ssh_cmd__(self, data: dict, command: dict) -> dict:
        results = {}
        port = data.get("port", None)
        ssh = data.get("ssh", None)
        if not self.__is_ssh_alive__(ssh):
            try:
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect(
                    hostname='localhost',
                    port=port,
                    username='root',
                    key_filename=f'{self.__ssh_path__}/id_ecdsa',
                    timeout=1,
                    compress=True
                )
                data["ssh"] = ssh
            except paramiko.SSHException as _e:
                print(f"SSH execute failed, port: {port}")
                return {"status": False, "msg": "SSH execute failed"}
        for remark, item in command.items():
            results[remark] = {}
            cmd = item.get("cmd", None)
            output = item.get("output", True)
            pattern = item.get("pattern", None)
            if not cmd:
                continue
            stdin, stdout, stderr = ssh.exec_command(cmd)
            std_output = stdout.read().decode('utf-8')
            stderr_output = stderr.read().decode('utf-8')
            exit_code = stdout.channel.recv_exit_status()
            if output:
                if exit_code == 0:
                    results[remark]["status"] = True
                    output = re.sub(rf'{re.escape(cmd)}\r\n?', '', std_output.strip())
                    if pattern:
                        results[remark]["output"] = re.findall(pattern, output)
                    else:
                        results[remark]["output"] = output.splitlines()
                else:
                    results[remark]["status"] = False
                    results[remark]["output"] = stderr_output.strip().splitlines()
        return results

    def __fetch_info__(self, ecid: str, data: dict, ecids, more_info) -> Union[dict, None]:
        __detail_info__ = {ecid: {}}
        if isinstance(ecids, list) and ecid not in ecids:
            return None
        port = data.get("port", None)
        if not isinstance(port, int):
            return None
        if (not self.__detail_info__.get(ecid, None) or
                not self.__detail_info__.get(ecid, None).get("static_info", False)):
            timestamp = time.time()
            print(f"[{datetime.fromtimestamp(timestamp).strftime('%Y-%m-%dT%H:%M:%S')}] Unit {ecid} getting static info")
            __detail_info__[ecid]["check_timestamp"] = int(timestamp)
            results = self.__remote_ssh_cmd__(data, __STATIC_COMMAND__)
            sw_version = results.get("sw_version", {}).get("output", None)
            serial_number = results.get("serial_number", {}).get("output", None)
            battery = results.get("battery", {}).get("output", None)
            temperature = results.get("temperature", {}).get("output", None)
            llm_packs = results.get("llm_packs", {}).get("output", None)
            data_size_str = results.get("data_size_str", {}).get("output", None)
            configs = results.get("configs", {}).get("output", None)
            vendor_str = results.get("vendor_str", {}).get("output", None)
            if "No such file or directory" in safe_get(data_size_str, 0):
                results["data_size_str"]["status"] = True
            if "does not exist" in safe_get(configs, 0, ""):
                results["configs"]["status"] = True
            if any(keyword in safe_get(vendor_str, -1, "")
                   for keyword in
                   ["couldn’t be completed", "Error writing to device", "Error reading from device", "reading"]
                   ):
                results["vendor_str"]["status"] = True
            static_info = True
            for remark, _data in results.items():
                static_info = static_info and _data["status"]
            configs_split = safe_get(configs, 0, "").split('/')
            unit_number = safe_get(configs_split, 5, "").strip()
            config = safe_get(configs_split, 4, "").strip()
            if "No such file or directory" in safe_get(data_size_str, 0):
                data_size = "0K"
            else:
                size = safe_get(data_size_str, 0, "0K").strip().split()[0]
                data_size = "0K" if size.endswith("K") else size
            llm_pack = "\n".join(llm_packs)
            cg_vendor = __CG_VENDOR_MAP__.get((safe_get(vendor_str, -1, "").strip()), "NA")
            __detail_info__[ecid]["sw_vers"] = safe_get(sw_version, 0, "").strip()
            __detail_info__[ecid]["serial_number"] = safe_get(serial_number, 0, "").strip()
            __detail_info__[ecid]["battery"] = safe_get(battery, 0, "").strip()
            __detail_info__[ecid]["temperature"] = safe_get(temperature, 0, "").strip()
            __detail_info__[ecid]["unit_number"] = unit_number
            __detail_info__[ecid]["config"] = config
            __detail_info__[ecid]["data_size"] = data_size
            __detail_info__[ecid]["cg_vendor"] = cg_vendor
            __detail_info__[ecid]["static_info"] = static_info
            __detail_info__[ecid]["llm_pack"] = llm_pack
            if more_info:
                pass
        else:
            if int(time.time()) - self.__detail_info__.get(ecid, {}).get("check_timestamp", int(time.time())) > 10:
                __detail_info__[ecid]["check_timestamp"] = int(time.time())
                results = self.__remote_ssh_cmd__(data, __DYNAMIC_COMMAND__)
                battery = results["battery"]["output"]
                temperature = results["temperature"]["output"]
                data_size_str = results["data_size_str"]["output"]
                if "No such file or directory" in safe_get(data_size_str, 0):
                    data_size = "0K"
                else:
                    size = safe_get(data_size_str, 0, "0K").strip().split()[0]
                    data_size = "0K" if size.endswith("K") else size
                __detail_info__[ecid]["battery"] = safe_get(battery, 0, "").strip()
                __detail_info__[ecid]["temperature"] = safe_get(temperature, 0, "").strip()
                __detail_info__[ecid]["data_size"] = data_size
                if more_info:
                    pass
        return __detail_info__

    def __on_fetch_done__(self, future) -> None:
        try:
            result = future.result()
        except Exception:
            return
        if not isinstance(result, dict):
            return
        with self.__detail_lock__:
            for ecid, data in result.items():
                if not self.__detail_info__.get(ecid, None):
                    self.__detail_info__[ecid] = data
                else:
                    for data_key, data_value in data.items():
                        self.__detail_info__[ecid][data_key] = data_value

    def get_detail_info(self, running_ecids: list[str], ecids=None, more_info=False,
                        wait_timeout: float = 2.0) -> dict:
        ser_ecids = self.get_ecids(full=True)
        allowed_ser_ecids = {ecid: data for ecid, data in ser_ecids.items() if ecid not in running_ecids}
        now = time.monotonic()
        if now - self.__lifetime_last_run__ >= self.__lifetime_ttl__:
            self.__lifetime_last_run__ = now
            self.__process_dict_lifetime__()
        self.__gen_conn__(allowed_ser_ecids)
        futures = [
            self.__executor__.submit(self.__fetch_info__, ecid, data, ecids, more_info)
            for ecid, data in self.__process_dict__.items()
            if ecid not in running_ecids
        ]
        for future in futures:
            future.add_done_callback(self.__on_fetch_done__)
        if futures and wait_timeout is not None and wait_timeout > 0:
            wait(futures, timeout=wait_timeout)
        # 连接清理放到后台，避免阻塞本次返回（同一时间只允许一个清理任务）
        self.__schedule_cleanup__()
        with self.__detail_lock__:
            if isinstance(ecids, list) and ecids:
                return {ecid: dict(data) for ecid, data in self.__detail_info__.items() if ecid in ecids}
            else:
                return {ecid: dict(data) for ecid, data in self.__detail_info__.items()}


class UnitServer(Detector):
    def __init__(self, base_path: Path):
        super().__init__()
        self.__base_path__ = base_path

    def __rsync_core__(self, data: dict, source: str, target: str) -> Tuple[bool, str]:
        port = data.get("port", None)
        rsync_cmd = [
            "rsync",
            "-avcz",
            "--del",
            "--links",
            "-e",
            f"ssh -p {port} -C -o StrictHostKeyChecking=no -o UserKnownHostsFile={self.__ssh_path__} -i {self.__ssh_path__}/id_ecdsa"
        ]
        rsync_cmd.extend([source, target])
        process = self.__run_cmd__(rsync_cmd)
        _stdout, stderr_output = self.__wait_process__(process, timeout=300)
        if process.returncode == 0:
            return True, f"Success rsync {source} to {target}"
        else:
            return False, f"Failed to rsync {source} to {target}: {stderr_output}"

    def discharge_battery(self, ecids: list[str], target_power: int = 5) -> Tuple[bool, str]:
        discharge_resources_file_name = "discharge_resources"
        ser_ecids = self.get_ecids(full=True)
        self.get_detail_info([], None)
        pushed_ecids = []
        success_ecids = []
        discharge_resources = self.__base_path__ / discharge_resources_file_name
        for ecid in ecids:
            location_id = ser_ecids.get(ecid, {}).get("loc", None)
            if location_id:
                copy_process = self.__run_cmd__(
                    ["copyUnrestricted", "-w", "-u", location_id, "-s", str(discharge_resources), "-t", "/var/root"])
                self.__wait_process__(copy_process, timeout=30)
                pushed_ecids.append(ecid)
        for ecid in pushed_ecids:
            data = self.__process_dict__.get(ecid, {})
            if data.get("port"):
                command = (
                    f'cd /var/root/{discharge_resources_file_name} ; '
                    'chmod +x unit_batterydischarge.sh ; '
                    f'screen -S batterydischarge -s /bin/zsh -d -m ./unit_batterydischarge.sh {target_power}'
                )
                self.__remote_ssh_cmd__(data, {"sw_version": {
                    "cmd": command,
                    "output": False
                }})
                success_ecids.append(ecid)
        if len(ecids) == len(success_ecids):
            return True, "Start discharging battery"
        else:
            failed_units = ", ".join([ecid for ecid in ecids if ecid not in success_ecids])
            return False, f"Failed to start discharging battery: {failed_units}"

    def cmd_tools(self, ecids: list[str],
                  cmd: CmdTool) -> Tuple[bool, str]:
        self.get_detail_info([], None)
        success_ecids = []
        for ecid in ecids:
            data = self.__process_dict__.get(ecid, {})
            if data.get("port"):
                command = " ; ".join(__CMD_MAP__.get(cmd, (cmd,)))
                self.__remote_ssh_cmd__(data, {"sw_version": {
                    "cmd": command,
                    "output": False
                }})
                success_ecids.append(ecid)
        if len(ecids) == len(success_ecids):
            return True, f"Success send {cmd}"
        else:
            failed_units = ", ".join([ecid for ecid in ecids if ecid not in success_ecids])
            return False, f"Failed to send {cmd}: {failed_units}"

    def upload_file_to_unit(self, ecid: str) -> Tuple[
                                                    Callable[
                                                        [str | Path, str, Literal],
                                                        Tuple[bool, int, str]
                                                    ], Callable[
                                                        [str | Path, str, Literal],
                                                        Tuple[bool, str]]
                                                ] | bool:
        self.get_detail_info([], None)
        data = self.__process_dict__.get(ecid, {})
        port = data.get("port", None)
        unit_temp_path = None
        if port:
            command = "mktemp -d"
            mktmp_result, mktmp_output = self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": command}})
            if not mktmp_result:
                return False
            unit_temp_path = safe_get(mktmp_output, 0, None).strip()
        if not port or not unit_temp_path:
            return False
        shasum_tool = self.__base_path__.joinpath("unit_tools/shasum.py")
        unit_shasum_path = None
        _unit_shasum_path = "/var/root/shasum_tool"
        rsync_result, _ = self.__rsync_core__(data, str(shasum_tool), f"root@localhost:{_unit_shasum_path}")
        if rsync_result:
            unit_shasum_path = _unit_shasum_path

        def upload(file_part: str | Path,
                   sha_value: str = "",
                   sha_option: Literal["sha1", "sha224", "sha256", "sha384", "sha512"] = "sha1"
                   ) -> Tuple[bool, int, str]:
            nonlocal unit_temp_path, unit_shasum_path
            if not Path(file_part).exists():
                return False, 409, f"File {file_part} does not exist"
            target_file = Path(unit_temp_path) / Path(file_part).name
            result, _ = self.__rsync_core__(data, file_part, f"root@localhost:{target_file}")
            if result:
                if unit_shasum_path and sha_value:
                    shasum_cmd = f'python3 {unit_shasum_path} {sha_option} {target_file}'
                    sha_result, sha_output = self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": shasum_cmd}})
                    if not sha_result:
                        return False, 400, "Failed to run shasum"
                    sha_result = safe_get(sha_output, 0, None).strip()
                    if sha_result != sha_value:
                        return False, 409, "Sha result mismatch"
            return True, 200 if result else 400, f"Success upload {file_part}" if result else f"Failed to upload {file_part}"

        def merge(target_path: str | Path,
                  sha_value: str = "",
                  sha_option: Literal["sha1", "sha224", "sha256", "sha384", "sha512"] = "sha1"
                  ) -> Tuple[bool, str]:
            nonlocal unit_temp_path, unit_shasum_path
            merge_command = (
                f'cd {unit_temp_path} ; '
                f'ls part_* | sort -V | xargs cat > {target_path} ; '
                f'ls {target_path}'
            )
            output = self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": merge_command}})
            if unit_shasum_path and sha_value:
                shasum_cmd = f'python3 {unit_shasum_path} {sha_option} {target_path}'
                sha_result, sha_output = self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": shasum_cmd}})
                sha_result = safe_get(sha_output, 0, None).strip()
                if sha_result != sha_value:
                    return False, "Sha result mismatch"
            if "No such file or directory" in output:
                return False, f"Merge failed: {target_path}"
            else:
                return True, f"Success merge {target_path}"

        return upload, merge

    def download_file_from_unit(self, ecid: str, file_path: str | Path) -> Generator[
            Tuple[bool, str], Any, Tuple[bool, str]]:
        self.get_detail_info([], None)
        data = self.__process_dict__.get(ecid, {})
        port = data.get("port", None)
        unit_temp_path = None
        if port:
            command = "mktemp -d"
            mktmp_result, mktmp_output = self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": command}})
            if not mktmp_result:
                return False, "Failed to mktmp"
            unit_temp_path = safe_get(mktmp_output, 0, None).strip()
        if not port or not unit_temp_path:
            return False, "Failed to download file"
        shasum_tool = self.__base_path__.joinpath("unit_tools/shasum.py")
        # unit_shasum_path = None
        _unit_shasum_path = "/var/root/shasum_tool"
        rsync_result, _ = self.__rsync_core__(data, str(shasum_tool), f"root@localhost:{_unit_shasum_path}")
        # if rsync_result:
        #     unit_shasum_path = _unit_shasum_path
        split_cmd = f"split -b 1M {file_path} {unit_temp_path}/part_"
        self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": split_cmd}})
        split_result, split_files = self.__remote_ssh_cmd__(data, {"sw_version": {"cmd": f"ls {unit_temp_path}/part_*"}})
        if not split_result:
            return False, "Failed to split file"
        local_tmp = tempfile.mkdtemp()
        for file in split_files:
            rsync_result = False
            for _ in range(10):
                rsync_result, _ = self.__rsync_core__(data, f"root@localhost:{unit_temp_path}/{file}", local_tmp)
                if rsync_result:
                    break
            if not rsync_result:
                return False, "Failed to download file"
            yield True, f"{local_tmp}/{file}"
        return False, "Failed to download file"


if __name__ == '__main__':
    t = UnitServer(Path().home() / ".stress_rack_test")
    t.start()
    t.get_ecids(True)
    time.sleep(1)
    downloader = t.download_file_from_unit(ecid="00017C803400010A", file_path="/var/root/file")
    for value in downloader:
        print(value)
        print(value[0])
        print(value[1])
