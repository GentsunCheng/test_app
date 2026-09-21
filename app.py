import sys
import zipfile
from pathlib import Path
import web_server


__VERSION__ = "2610a"
__RESOURCE_VERSION__ = "2610v1"


def smart_extract(zip_path: Path, base_output_dir: Path) -> None:
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        files = [
            _f.filename for _f in zip_ref.infolist()
            if not _f.is_dir() and not _f.filename.startswith("__MACOSX") and not _f.filename.endswith(".DS_Store")
        ]
        if all(not _f.startswith("/") and "/" not in _f for _f in files):
            output_dir = base_output_dir / zip_path.stem
            output_dir.mkdir(parents=True, exist_ok=True)
            for file in files:
                zip_ref.extract(file, output_dir)
        else:
            for file in files:
                zip_ref.extract(file, base_output_dir)


def extract_resources() -> None:
    resource_path = Path(__file__).resolve().parent / "resources"
    resource_file_list = list(resource_path.glob("**/*.zip"))
    for resource_file in resource_file_list:
        smart_extract(resource_file, base_path)
    with open(base_path / ".resources_version", "w") as _f:
        _f.write(__RESOURCE_VERSION__)


base_path = Path().home().joinpath(".stress_rack_test")
if not base_path.exists():
    print("Initializing stress rack resources")
    base_path.mkdir(parents=True)
    extract_resources()
if not base_path.joinpath("logs").exists():
    base_path.joinpath("logs").mkdir()

if not base_path.joinpath("config").exists():
    base_path.joinpath("config").mkdir()

with open(base_path / ".resources_version", "r") as f:
    resources_version = f.read()
    if resources_version != __RESOURCE_VERSION__:
        print("Updating stress rack resources")
        extract_resources()


if __name__ == '__main__':
    __management__ = web_server.Management(
        units_detector=web_server.backend.units_core.UnitServer(base_path=base_path),
        test_scripts=web_server.backend.run_scripts.TestScript(base_path=base_path)
    )
    app = __management__.app
    _exit_code = 0
    try:
        app.run(
            host='0.0.0.0',
            port=8196,
            debug=False,
            use_reloader=False,
            threaded=True
        )
    except KeyboardInterrupt:
        print("User interrupted")
        _exit_code = 0
    except Exception as e:
        print(f"Exception: {e}")
        _exit_code = 1
    finally:
        __management__.shutdown()
        sys.exit(_exit_code)
