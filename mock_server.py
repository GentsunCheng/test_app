import yaml
from flask import Flask, jsonify, request, Response
import time

app = Flask(__name__)

def load_openapi_spec(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

spec = load_openapi_spec('openapi.yaml')

def get_example_response(path, method, status_code=200):
    try:
        path_item = spec['paths'][path]
        method_item = path_item[method.lower()]
        responses = method_item['responses']
        
        # Try both integer and string status code
        response_item = responses.get(status_code) or responses.get(str(status_code))
        
        if not response_item:
            return None, None
            
        # Check for content types
        content = response_item.get('content', {})
        for content_type, details in content.items():
            if 'example' in details:
                return details['example'], content_type
            elif 'examples' in details:
                # Return the first example if multiple exist
                first_example_key = list(details['examples'].keys())[0]
                return details['examples'][first_example_key].get('value'), content_type
    except Exception as e:
        print(f"Error getting example for {method} {path}: {e}")
    return None, None

def create_route(path, method):
    endpoint = f"{method}_{path.replace('/', '_')}"
    
    @app.route(path, methods=[method], endpoint=endpoint)
    def handler(*args, **kwargs):
        example, content_type = get_example_response(path, method)
        
        if path == '/api/logs' and method == 'POST':
            # Special handling for SSE
            def generate():
                try:
                    lines = example.split('\n')
                    times = 5
                    for line in lines:
                        for _ in range(times):
                            yield f"{line}\n\n"
                            time.sleep(0.25)
                except (GeneratorExit, Exception):
                    # This happens when the client disconnects or aborts
                    print(f"Client disconnected from logs: {path}")
                    
            return Response(generate(), mimetype='text/event-stream')

        if example is not None:
            if content_type == 'application/json':
                return jsonify(example)
            else:
                return Response(str(example), mimetype=content_type)
        
        return jsonify({"status": "success", "message": f"Mock response for {method} {path}"})

# Register routes from spec
for path, methods in spec.get('paths', {}).items():
    for method in methods:
        if method.lower() in ['get', 'post', 'put', 'delete', 'patch']:
            create_route(path, method.upper())

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Secret-Key, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    return response

if __name__ == '__main__':
    print("Starting mock server based on openapi.yaml...")
    app.run(host='0.0.0.0', port=8196, debug=True)
