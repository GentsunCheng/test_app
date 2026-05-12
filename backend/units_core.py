import os
import re
import time
import socket
import random
import asyncio
import pexpect
import hashlib
import subprocess as sp
import shutil
from pathlib import Path
from multiprocessing import Process
from multiprocessing.shared_memory import SharedMemory
import pickle
import tempfile
import traceback
from typing import Union, Callable, Tuple, Any, Literal

__CG_VENDOR_MAP__ = {
    "ea": "SDC",
    "9a": "LGD",
    "9b": "LGD",
    "64": "BOE",
    "65": "BOE",
}


def safe_get(lst: list, index: int, default=None) -> Any:
    return lst[index] if 0 <= abs(index) < len(lst) else default


def is_port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('0.0.0.0', port))
            return True
        except socket.error as _e:
            return False


def random_port(debug: bool = False, try_count: int = 1000) -> int:
    if not debug:
        for _ in range(try_count):
            port = random.randint(10000, 30000)
            if is_port_available(port):
                return port
    return 5000


def file_hash(file_path: Union[Path, str], hash_algorithm: Literal["sha256", "sha384", "sha512"] = "sha256") -> str:
    if isinstance(file_path, str) and not os.path.exists(file_path):
        return ""
    elif isinstance(file_path, Path) and not file_path.exists():
        return ""
    hash_func = getattr(hashlib, hash_algorithm)()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            hash_func.update(chunk)
    return hash_func.hexdigest()


def are_files_equal(file1: Union[Path, str], file2: Union[Path, str]) -> bool:
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


class AsyncDetector:
    def __init__(self):
        self.__processing__ = None
        self.__shm__ = None
        self.__running__ = True
        self.__process_dict__ = {}
        self.__detail_info__ = {}
        self.__external_removable_process_ecids__ = []
        self.__ssh_path__ = gen_ssh_key()
        self.__process_external_data_thread__ = None

    @staticmethod
    async def __detector__(name: str) -> None:
        __ecids__ = {}
        __remove_ecids__ = []
        __shm__ = SharedMemory(name=name)
        __buf__ = __shm__.buf
        while True:
            try:
                await asyncio.sleep(0.2)
                proc = await asyncio.create_subprocess_exec(
                    "usbterm", "-list",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode:
                    continue
                lines = stdout.decode().strip().splitlines()
                __remove_ecids__.clear()

                for ecid in __ecids__.keys():
                    if not any(ecid in line for line in lines):
                        __remove_ecids__.append(ecid)

                for line in lines:
                    line_split = [s.replace(',', '') for s in line.split()]
                    if len(line_split) > 3:
                        location_id = safe_get(line_split, 2, "").strip()
                        ser_ecid = safe_get(line_split, 3, "").strip()
                        __ecids__[ser_ecid.strip()[8:24]] = {}
                        __ecids__[ser_ecid.strip()[8:24]]["ser"] = ser_ecid.strip()[:8]
                        __ecids__[ser_ecid.strip()[8:24]]["loc"] = location_id

                for remove_ecid in __remove_ecids__:
                    __ecids__.pop(remove_ecid, None)

                serialized = pickle.dumps(__ecids__)
                __buf__[:4] = len(serialized).to_bytes(4, byteorder='little')
                __buf__[4:4 + len(serialized)] = serialized
            except KeyboardInterrupt:
                if hasattr(__shm__, 'close'):
                    __shm__.close()
                break
            except Exception as e:
                print(f"An error occurred: {e}")
                traceback.print_exc()
                if hasattr(__shm__, 'close'):
                    __shm__.close()
                break

    def __run__(self) -> None:
        asyncio.run(self.__detector__(self.__shm__.name))

    def start(self, max_mem: int = 1024) -> Callable[..., None]:
        self.__processing__ = None
        self.__shm__ = SharedMemory(create=True, size=max_mem)
        self.__processing__ = Process(target=self.__run__)
        self.__processing__.start()
        return self.__processing__.join

    def stop(self) -> None:
        for ecid, data in self.__process_dict__.items():
            data.get("tcprelay", sp.Popen(['echo'])).terminate()
            data.get("ssh", pexpect.spawn('echo')).terminate()
        self.__processing__.terminate()
        self.__processing__ = None
        self.__running__ = False
        self.__shm__.close()
        self.__shm__.unlink()

    def get_ecids(self, full: bool = False) -> Union[dict, list]:
        data = {} if full else []
        if self.__running__ and self.__shm__:
            buf = self.__shm__.buf
            data_length = int.from_bytes(buf[:4], byteorder='little')
            if data_length > 0:
                data_full = pickle.loads(buf[4:4 + data_length])
                if full:
                    data = {k: v for k, v in data_full.items() if k and v}
                else:
                    data_before = list(data_full.keys())
                    data = list({item for item in data_before if item})
        return data

    def __process_dict_lifetime__(self) -> None:
        ecids = self.get_ecids()
        removable_process_ecids = []
        for ecid, data in self.__process_dict__.items():
            if ecid not in ecids:
                removable_process_ecids.append(ecid)
                data.get("tcprelay", sp.Popen(['echo'])).terminate()
                data.get("ssh", pexpect.spawn('echo')).terminate()
        for removable_process_ecid in removable_process_ecids:
            self.__process_dict__.get(removable_process_ecid, {}).get("tcprelay", sp.Popen(['echo'])).terminate()
            self.__process_dict__.get(removable_process_ecid, {}).get("ssh", pexpect.spawn('echo')).terminate()
        removable_process_ecids.extend(self.__external_removable_process_ecids__)
        for removable_process_ecid in removable_process_ecids:
            self.__process_dict__.pop(removable_process_ecid, None)
            self.__detail_info__.pop(removable_process_ecid, None)
        self.__external_removable_process_ecids__.clear()

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
    def __shell_pexpect__(cmd: str) -> Union[pexpect.spawn, bool]:
        child = pexpect.spawn(cmd)
        patterns = [
            r'iPhone:~ .+#',
            r'Permission denied',
            r"Connection reset by peer",
            pexpect.EOF,
            pexpect.TIMEOUT,
        ]
        error_messages = {
            1: "SSH Error: Permission denied",
            2: "SSH Error: Connection reset by peer",
            3: "SSH Error: EOF",
            4: "SSH Error: Timeout"
        }
        index = child.expect(patterns, timeout=30)
        if index in error_messages:
            print(error_messages[index])
            child.close()
            return False
        return child

    def __gen_conn__(self, allowed_ser_ecids: dict) -> None:
        for ecid, data in allowed_ser_ecids.items():
            serialnumber = data["ser"] + '-' + ecid
            location_id = data["loc"]
            port = random_port()
            if not self.__process_dict__.get(ecid, None):
                self.__process_dict__[ecid] = {}
                self.__ssh_path__ = gen_ssh_key()
                self.__run_cmd__(
                    ["copyUnrestricted", "-w", "-u", location_id, "-s", str(self.__ssh_path__), "-t", "/var/root"])
                if not self.__process_dict__.get(ecid, {}).get("tcprelay", None):
                    self.__process_dict__[ecid]["tcprelay"] = self.__run_cmd__(
                        ['tcprelay', '--serialnumber', serialnumber,
                         '--portoffset', f'{port - 22}', '22'])
                if not self.__process_dict__.get(ecid, {}).get("ssh", None):
                    shell_pexpect = self.__shell_pexpect__(
                        f"ssh -p {str(port)} root@localhost " +
                        "-o StrictHostKeyChecking=no " +
                        f"-o UserKnownHostsFile={self.__ssh_path__} " +
                        f"-i {self.__ssh_path__}/id_ecdsa")
                    if shell_pexpect:
                        self.__process_dict__[ecid]["ssh"] = shell_pexpect
                    if not shell_pexpect:
                        self.__external_removable_process_ecids__.append(ecid)

    @staticmethod
    def __get_child_output__(ssh_conn: pexpect.spawn, cmd: str, pattern: str = "") -> Tuple[bool, list[str]]:
        if not isinstance(ssh_conn, pexpect.spawn):
            return False, []
        try:
            if not ssh_conn.isalive():
                print("SSH connection is not alive.")
                return False, []
            ssh_conn.sendline(cmd)
            index = ssh_conn.expect(r'iPhone:~ .+#', timeout=30)
            if index == pexpect.TIMEOUT:
                print("Command execution timed out.")
                return False, []
            output = re.sub(rf'{re.escape(cmd)}\r\n?', '', ssh_conn.before.decode())
            if pattern:
                results = re.findall(pattern, output)
            else:
                results = output.splitlines()
            return True, [result for result in results if result]
        except pexpect.exceptions.TIMEOUT:
            print("Expect timeout occurred.")
            return False, []
        except OSError as e:
            print(f"OS I/O error: {e}")
            return False, []
        except Exception as e:
            print(f"Unexpected error: {e}")
            return False, []

    def get_detail_info(self, running_ecids: list[str], ecids=None, force=False) -> dict:
        ser_ecids = self.get_ecids(full=True)
        allowed_ser_ecids = {ecid: data for ecid, data in ser_ecids.items() if ecid not in running_ecids}
        if force:
            start_time = time.time()
            timeout = 3000
            while time.time() - start_time < timeout / 1000:
                self.__process_dict_lifetime__()
                self.__gen_conn__(allowed_ser_ecids)
                for ecid, data in self.__process_dict__.items():
                    if data.get("ssh", None):
                        allowed_ser_ecids.pop(ecid, None)
                if not allowed_ser_ecids:
                    break
        else:
            self.__process_dict_lifetime__()
            self.__gen_conn__(allowed_ser_ecids)
        for ecid, data in self.__process_dict__.items():
            if isinstance(ecids, list) and ecid not in ecids:
                continue
            ssh_conn = data.get("ssh", None)
            if not isinstance(ssh_conn, pexpect.spawn):
                continue
            info_result = True
            if self.__detail_info__.get(ecid, None):
                if int(time.time()) - self.__detail_info__.get(ecid, {}).get("check_timestamp", int(time.time())) > 10:
                    self.__detail_info__[ecid]["check_timestamp"] = int(time.time())
                    result, battery = self.__get_child_output__(ssh_conn, "smcif -kd BUIC")
                    info_result = info_result and result
                    result, temperature = self.__get_child_output__(ssh_conn, "smcif -kd TG0V")
                    info_result = info_result and result
                    result, data_size_str = self.__get_child_output__(ssh_conn, "du -h -d=1 results")
                    info_result = info_result and result
                    if "No such file or directory" in data_size_str:
                        data_size = "0K"
                    else:
                        size = safe_get(data_size_str, 0, "0K").strip().split()[0]
                        data_size = "0K" if size.endswith("K") else size
                    self.__detail_info__[ecid]["battery"] = safe_get(battery, 0, "").strip()
                    self.__detail_info__[ecid]["temperature"] = safe_get(temperature, 0, "").strip()
                    self.__detail_info__[ecid]["data_size"] = data_size
            else:
                self.__detail_info__[ecid] = {}
                self.__detail_info__[ecid]["check_timestamp"] = int(time.time())
                result, sw_version = self.__get_child_output__(ssh_conn, "sw_vers --buildVersion")
                info_result = info_result and result
                result, serial_number = self.__get_child_output__(ssh_conn, "gestalt_query SerialNumber",
                                                                  r'SerialNumber:\s*"([^"]+)"')
                info_result = info_result and result
                result, battery = self.__get_child_output__(ssh_conn, "smcif -kd BUIC")
                info_result = info_result and result
                result, temperature = self.__get_child_output__(ssh_conn, "smcif -kd TG0V")
                info_result = info_result and result
                result, data_size_str = self.__get_child_output__(ssh_conn, "du -h -d=1 results")
                info_result = info_result and result
                result, configs = self.__get_child_output__(ssh_conn, "sysconfig read -r -k 'CFG#'")
                info_result = info_result and result
                result, vendor_str = self.__get_child_output__(ssh_conn,
                                                               "powerswitch lcd on ; "
                                                               "displayPort -edp -auxFilter 0 ; "
                                                               "displayPort -edp -wdpcd 0x4e0 2 0xb1 0x00 ; "
                                                               "displayPort -edp -rdpcd 0x4f1 1 | cut -d ' ' -f 2"
                                                               )
                info_result = info_result and result
                configs_split = safe_get(configs, 0, "").split('/')
                unit_number = safe_get(configs_split, 5, "").strip()
                config = safe_get(configs_split, 4, "").strip()
                if "No such file or directory" in data_size_str:
                    data_size = "0K"
                else:
                    size = safe_get(data_size_str, 0, "0K").strip().split()[0]
                    data_size = "0K" if size.endswith("K") else size
                cg_vendor = __CG_VENDOR_MAP__.get((safe_get(vendor_str, -1, "").strip()), "NA")
                self.__detail_info__[ecid]["sw_vers"] = safe_get(sw_version, 0, "").strip()
                self.__detail_info__[ecid]["serial_number"] = safe_get(serial_number, 0, "").strip()
                self.__detail_info__[ecid]["battery"] = safe_get(battery, 0, "").strip()
                self.__detail_info__[ecid]["temperature"] = safe_get(temperature, 0, "").strip()
                self.__detail_info__[ecid]["unit_number"] = unit_number
                self.__detail_info__[ecid]["config"] = config
                self.__detail_info__[ecid]["data_size"] = data_size
                self.__detail_info__[ecid]["cg_vendor"] = cg_vendor
            if not info_result:
                self.__external_removable_process_ecids__.append(ecid)
        if isinstance(ecids, list) and ecids:
            return {ecid: data for ecid, data in self.__detail_info__.items() if ecid in ecids}
        else:
            return self.__detail_info__[ecids]


class UnitServer(AsyncDetector):
    def __init__(self):
        super().__init__()


if __name__ == '__main__':
    t = UnitServer()
    joiner = t.start()
    while True:
        try:
            print(t.get_ecids())
            print(t.get_detail_info([]))
            time.sleep(0.5)
        except KeyboardInterrupt:
            t.stop()
            joiner()
            break
