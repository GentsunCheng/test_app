from datetime import datetime
from typing import Callable


def logger_debug(func: Callable) -> Callable:
    def wrapper(*args, **kwargs):
        func_name = func.__name__
        try:
            start_time = datetime.timestamp(datetime.now())
            result = func(*args, **kwargs)
            end_time = datetime.timestamp(datetime.now())
            time_spend = end_time - start_time
            status = "finished"
        except Exception as e:
            result = e
            status = "failed"
            time_spend = 0
        current_time = datetime.now().strftime("%m%dT%H%M%S")
        if result:
            log_str = f"{current_time} | status: {status} | {func_name}: {result} | time_spend: {time_spend}"
        else:
            log_str = f"{current_time} | status: {status} | {func_name} | time_spend: {time_spend}"
        print(log_str)
        return result

    return wrapper
