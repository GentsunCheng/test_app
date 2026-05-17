import sys
import json
import random
import atexit
import logging
from pathlib import Path
from flask import Flask, jsonify, request, Response, stream_with_context, abort
from flask_cors import CORS
import backend

try:
    import conf

    __SECRET_KEY__ = conf.SECRET_KEY
except ModuleNotFoundError:
    __SECRET_KEY__ = random.randbytes(256).decode(encoding='UTF-8')

__allowed_ips__ = ["127.0.0.1"]
__ip_conf__ = Path().home().joinpath('.transfer.png')
if __ip_conf__.exists():
    with open(__ip_conf__, 'r') as f:
        _data = json.load(f)
        remote_config = _data.get("remote_config", {})
        for conf in remote_config:
            ip = conf.get("ip", None)
            if ip:
                __allowed_ips__.append(ip)


def resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        # noinspection PyProtectedMember
        return Path(sys._MEIPASS).joinpath(relative_path)
    return Path(__file__).parent.joinpath(relative_path)


class Management:
    def __init__(self, units_detector: backend.units_core.UnitServer,
                 test_scripts: backend.run_scripts.TestScript):
        self.app = Flask("StressRack",
                         static_folder=resource_path('frontend/web-source'),
                         static_url_path='/')
        self.app.logger.setLevel(logging.CRITICAL)
        logging.getLogger('werkzeug').setLevel(logging.CRITICAL)
        CORS(self.app)
        self.app.secret_key = __SECRET_KEY__
        self.units_detector = units_detector
        self.test_scripts = test_scripts
        self.units_detector.start()
        self.register_routes()
        atexit.register(self.shutdown)

    def shutdown(self):
        self.units_detector.stop()
        self.test_scripts.stop()

    def register_routes(self):
        @self.app.before_request
        def verify_client():
            if request.remote_addr not in __allowed_ips__:
                abort(403)
            return None

        @self.app.route('/api/preload', methods=['GET'])
        def preload():
            self.units_detector.get_detail_info(self.test_scripts.get_testing_ecids(), None)
            return jsonify({"status": "success"}), 200

        @self.app.route('/api/ecids', methods=['GET'])
        def get_units():
            return jsonify(self.units_detector.get_ecids()), 200

        @self.app.route('/api/testing_ecids', methods=['GET'])
        def get_testing_ecids():
            return jsonify(self.test_scripts.get_testing_ecids()), 200

        @self.app.route('/api/detail_info', methods=['POST'])
        def get_detail_info():
            json_data = request.get_json()
            ecids = json_data.get('ecids', None)
            return jsonify(self.units_detector.get_detail_info(self.test_scripts.get_testing_ecids(), ecids)), 200

        @self.app.route('/api/logs', methods=['POST'])
        def stream_logs():
            json_data = request.get_json()
            ecids = json_data.get('ecids')
            if not ecids:
                return jsonify({'status': 'error', 'message': 'No ecids provided'}), 400
            return Response(stream_with_context(self.test_scripts.get_log_stream(ecids)), mimetype='text/event-stream'), 200

        @self.app.route('/api/script_info', methods=['GET'])
        def get_script_info():
            script_info = self.test_scripts.get_script_info()
            if isinstance(script_info, dict):
                return jsonify(script_info), 200
            else:
                return jsonify({'status': 'error', 'message': 'Script info error'}), 400

        @self.app.route('/api/script_methods', methods=['POST'])
        def get_script_methods():
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            script_name = data.get('script_name')
            script_path = data.get('script_path')
            if script_name and script_path:
                return jsonify({'status': 'error', 'message': 'Only need provide one argument'}), 400
            elif script_name and not script_path:
                result, methods_dict = self.test_scripts.get_script_methods(script_name=script_name)
            elif not script_name and script_path:
                result, methods_dict = self.test_scripts.get_script_methods(script_path=script_path)
            else:
                return jsonify({'status': 'error', 'message': 'No param provided'}), 400
            if result:
                return jsonify({'status': 'success', 'methods': methods_dict}), 200
            else:
                return jsonify({'status': 'error', 'methods': methods_dict}), 400

        @self.app.route('/api/add_test_script', methods=['POST'])
        def add_test_script():
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            script_name = data.get('script_name')
            script_path = data.get('script_path')
            if not script_name:
                return jsonify({'status': 'error', 'message': 'No script name provided'}), 400
            elif not script_path:
                return jsonify({'status': 'error', 'message': 'No test script path provided'}), 400
            else:
                add_result, msg = self.test_scripts.add_script_path(script_name, script_path)
                if not add_result:
                    return jsonify({'status': 'error', 'message': msg}), 400
            return jsonify({'status': 'success', 'added script': script_path}), 200

        @self.app.route('/api/scan_test_script', methods=['GET'])
        def scan_test_script():
            return jsonify(backend.run_scripts.scan_local_script()), 200

        @self.app.route('/api/remove_test_script', methods=['POST'])
        def remove_test_script():
            data = request.get_json()
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            script_name = data.get('script_name')
            script_path = data.get('script_path')
            if script_name and script_path:
                return jsonify({'status': 'error', 'message': 'Only need provide one argument'}), 400
            elif script_name and not script_path:
                msg_text = script_name
                remove_result, msg = self.test_scripts.remove_script_path(script_name=script_name)
            elif script_path and not script_name:
                msg_text = script_path
                remove_result, msg = self.test_scripts.remove_script_path(script_path=script_path)
            else:
                return jsonify({'status': 'error', 'message': 'No param provided'}), 400
            if remove_result:
                return jsonify({'status': 'success', 'removed script': msg_text}), 200
            else:
                return jsonify({'status': 'error', 'message': msg}), 400

        @self.app.route('/api/run_test_script', methods=['POST'])
        def run_test_script():
            data = request.get_json(silent=True)
            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            test_method = data.get('test_method')
            script_name = data.get('script_name')
            units = data.get('units')
            if not test_method or not units:
                return jsonify({'status': 'error', 'message': 'No test method provided'}), 400
            else:
                detail_info = self.units_detector.get_detail_info(self.test_scripts.get_testing_ecids(), units, True)
                run_result, msg = self.test_scripts.run_test_script(test_method, script_name, detail_info)
                if not run_result:
                    return jsonify({'status': 'error', 'message': msg}), 400
            return jsonify({'status': 'success', 'test_method': test_method, 'units': units}), 200

        @self.app.route('/api/drain_battery', methods=['POST'])
        def drain_battery():
            json_data = request.get_json()
            if not json_data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            ecids = json_data.get('ecids')
            target_power = json_data.get('target_power')
            if not ecids or not target_power:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            drain_result, msg = self.units_detector.drain_battery(ecids, target_power)
            if not drain_result:
                return jsonify({'status': 'error', 'message': msg}), 400
            return jsonify({'status': 'success', 'drain_result': drain_result}), 200

        @self.app.route('/api/send_ssh_cmd', methods=['POST'])
        def send_ssh_cmd():
            json_data = request.get_json()
            if not json_data:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            ecids = json_data.get('ecids')
            cmd = json_data.get('cmd')
            if not ecids or not cmd:
                return jsonify({'status': 'error', 'message': 'No data provided'}), 400
            cmd_result, msg = self.units_detector.cmd_tools(ecids, cmd)
            if not cmd_result:
                return jsonify({'status': 'error', 'message': msg}), 400
            return jsonify({'status': 'success', 'cmd': cmd}), 200

        @self.app.route('/', methods=['GET'])
        def index():
            return self.app.send_static_file('index.html')
