from datetime import datetime
from pathlib import Path
from typing import Tuple


def test_map_reset_increments_counter(app_module: Tuple[object, Path]) -> None:
    module, _ = app_module
    module.map_reset_counter = 0

    response1 = module.reset_map_endpoint()
    assert response1.status == "ok"
    assert response1.reset_counter == 1
    first_reset_at = response1.reset_at

    response2 = module.reset_map_endpoint()
    assert response2.status == "ok"
    assert response2.reset_counter == 2
    second_reset_at = response2.reset_at

    assert isinstance(first_reset_at, datetime)
    assert isinstance(second_reset_at, datetime)
    assert second_reset_at >= first_reset_at
