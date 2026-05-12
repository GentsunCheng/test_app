import sys
from pathlib import Path
import web_server


base_path = Path().home().joinpath(".stress_rack_test")
if not base_path.exists():
    base_path.mkdir(parents=True)
if not base_path.joinpath("logs").exists():
    base_path.joinpath("logs").mkdir()

if not base_path.joinpath("config").exists():
    base_path.joinpath("config").mkdir()


if __name__ == '__main__':
    __management__ = web_server.Management(
        units_detector=web_server.backend.units_core.UnitServer(),
        test_scripts=web_server.backend.run_scripts.TestScript(base_path=base_path)
    )
    app = __management__.app
    options = {
        'bind': '0.0.0.0:8196',
        'workers': 4,
        'worker_class': 'gthread',
        'threads': 8,
    }
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
