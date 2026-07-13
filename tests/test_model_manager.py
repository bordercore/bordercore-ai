"""Tests for in-process model lifecycle state."""

from unittest.mock import Mock, patch

from modules.model_manager import ModelManager


def test_model_manager_tracks_and_clears_loaded_checkpoint() -> None:
    """Runtime metadata follows the model reference through load and unload."""
    inference = Mock()
    inference.model = object()

    with (
        patch("modules.model_manager.get_model_info", return_value={"local": {}}),
        patch("modules.model_manager.Inference", return_value=inference),
        patch("modules.model_manager.gc.collect") as collect,
        patch("modules.model_manager.torch.cuda.empty_cache") as empty_cache,
    ):
        manager = ModelManager()
        manager.load("local")

        assert manager.get_loaded_model_name() == "local"
        assert manager.get_model() is inference.model
        inference.load_model.assert_called_once_with()

        manager.unload()

    assert manager.get_loaded_model_name() is None
    assert manager.get_model() is None
    collect.assert_called_once_with()
    empty_cache.assert_called_once_with()


def test_model_manager_does_not_mark_api_models_as_loaded() -> None:
    """Selecting a hosted API does not claim that it occupies local GPU RAM."""
    with patch(
        "modules.model_manager.get_model_info",
        return_value={"hosted": {"type": "api"}},
    ):
        manager = ModelManager()
        manager.load("hosted")

    assert manager.get_loaded_model_name() is None
    assert manager.get_model() is None
