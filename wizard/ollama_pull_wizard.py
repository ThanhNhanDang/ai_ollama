# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import logging
import threading
import requests

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# Global dict to track pull progress across requests.
# Key: model_name, Value: {status, progress_pct, status_text, error}
_pull_tasks = {}
_pull_lock = threading.Lock()


class OllamaPullWizard(models.TransientModel):
    _name = 'ollama.pull.wizard'
    _description = 'Pull Ollama Model'

    model_to_pull = fields.Char(
        string="Model Name",
        required=True,
        help="Name of the Ollama model to pull, e.g. 'llama3', 'mistral'. "
             "Browse all models at https://ollama.com/library",
    )
    resource_warning = fields.Char(
        string="Warning",
        readonly=True,
        help="Warning message displayed when resource constraints are detected.",
    )

    def _get_ollama_base_url(self):
        return self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")

    def action_pull(self):
        """Pull a model - called from the wizard form button."""
        self.ensure_one()
        model_name = self.model_to_pull
        if not model_name:
            raise UserError(_("Please enter a model name to pull."))

        base_url = self._get_ollama_base_url()

        try:
            _logger.info("AI Ollama: Starting pull for model '%s'", model_name)

            resp = requests.post(
                f"{base_url}/api/pull",
                json={"name": model_name, "stream": True},
                stream=True,
                timeout=(10, None),
            )

            if resp.status_code != 200:
                raise UserError(_("Ollama error: %s") % resp.text)

            for line in resp.iter_lines():
                if line:
                    try:
                        progress = json.loads(line)
                        if "error" in progress:
                            raise UserError(_("Ollama pull error: %s") % progress['error'])
                    except json.JSONDecodeError:
                        continue

            _logger.info("AI Ollama: Pull complete for '%s'", model_name)
            return {'type': 'ir.actions.act_window_close'}

        except requests.ConnectionError:
            raise UserError(_(
                "Cannot connect to Ollama at %(url)s. "
                "Make sure the Ollama server is running.",
                url=base_url,
            ))

    @api.model
    def action_pull_from_dashboard(self, model_name):
        """Start pulling a model in a background thread.
        Returns immediately so the UI can poll for progress.
        """
        with _pull_lock:
            if model_name in _pull_tasks and _pull_tasks[model_name]["status"] == "pulling":
                return {"already_pulling": True}

            _pull_tasks[model_name] = {
                "status": "pulling",
                "progress_pct": 0,
                "status_text": "Starting download...",
                "error": None,
            }

        base_url = self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")

        thread = threading.Thread(
            target=self._pull_model_background,
            args=(base_url, model_name),
            daemon=True,
        )
        thread.start()

        return {"started": True}

    @staticmethod
    def _pull_model_background(base_url, model_name):
        """Run the actual pull in a background thread, updating _pull_tasks."""
        try:
            _logger.info("AI Ollama: Background pull starting for '%s'", model_name)

            resp = requests.post(
                f"{base_url}/api/pull",
                json={"name": model_name, "stream": True},
                stream=True,
                timeout=(10, None),
            )

            if resp.status_code != 200:
                with _pull_lock:
                    _pull_tasks[model_name] = {
                        "status": "error",
                        "progress_pct": 0,
                        "status_text": f"HTTP {resp.status_code}",
                        "error": resp.text[:500],
                    }
                return

            for line in resp.iter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if "error" in data:
                    with _pull_lock:
                        _pull_tasks[model_name] = {
                            "status": "error",
                            "progress_pct": 0,
                            "status_text": "Error",
                            "error": data["error"],
                        }
                    return

                # Calculate progress from Ollama stream data
                total = data.get("total", 0)
                completed = data.get("completed", 0)
                status_text = data.get("status", "Downloading...")

                with _pull_lock:
                    current = _pull_tasks.get(model_name, {})
                    # Check if task was cancelled while downloading
                    if current.get("status") == "cancelled":
                        return
                    prev_pct = current.get("progress_pct", 0)

                if total > 0:
                    pct = round(completed / total * 100)
                else:
                    pct = 0

                # Never let progress go backwards (Ollama resets completed=0 for
                # each finalization phase: verifying sha256, writing manifest, etc.)
                pct = max(pct, prev_pct)

                with _pull_lock:
                    if _pull_tasks.get(model_name, {}).get("status") == "cancelled":
                        return
                    _pull_tasks[model_name] = {
                        "status": "pulling",
                        "progress_pct": pct,
                        "status_text": status_text,
                        "error": None,
                    }

            with _pull_lock:
                if _pull_tasks.get(model_name, {}).get("status") != "cancelled":
                    _pull_tasks[model_name] = {
                        "status": "done",
                        "progress_pct": 100,
                        "status_text": "Complete",
                        "error": None,
                    }

            _logger.info("AI Ollama: Background pull complete for '%s'", model_name)

        except requests.ConnectionError:
            with _pull_lock:
                if _pull_tasks.get(model_name, {}).get("status") != "cancelled":
                    _pull_tasks[model_name] = {
                        "status": "error",
                        "progress_pct": 0,
                        "status_text": "Connection failed",
                        "error": f"Cannot connect to Ollama at {base_url}",
                    }
        except Exception as e:
            _logger.exception("AI Ollama: Unexpected error pulling '%s'", model_name)
            with _pull_lock:
                if _pull_tasks.get(model_name, {}).get("status") != "cancelled":
                    _pull_tasks[model_name] = {
                        "status": "error",
                        "progress_pct": 0,
                        "status_text": "Unexpected error",
                        "error": str(e)[:500],
                    }

    @api.model
    def get_pull_progress(self, model_name):
        """RPC endpoint: return current pull progress for a model."""
        with _pull_lock:
            task = _pull_tasks.get(model_name)
            if not task:
                return {"status": "idle"}
            return dict(task)

    @api.model
    def get_all_pull_progress(self):
        """RPC endpoint: return progress for all active pull tasks."""
        with _pull_lock:
            return {k: dict(v) for k, v in _pull_tasks.items()}

    @api.model
    def clear_pull_task(self, model_name):
        """RPC endpoint: clear a finished/errored pull task.
        If still pulling, mark as cancelled so the background thread stops writing results.
        """
        with _pull_lock:
            task = _pull_tasks.get(model_name)
            if task and task.get("status") == "pulling":
                # Signal the background thread to stop, then remove
                _pull_tasks[model_name] = {"status": "cancelled"}
            else:
                _pull_tasks.pop(model_name, None)
        return True

    @api.model
    def action_delete_model(self, model_name):
        """Delete a model from Ollama - called from the OWL dashboard via RPC."""
        base_url = self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")

        try:
            _logger.info("AI Ollama: Deleting model '%s'", model_name)

            resp = requests.delete(
                f"{base_url}/api/delete",
                json={"name": model_name},
                timeout=10,
            )

            if resp.status_code != 200:
                raise UserError(_("Ollama error: %s") % resp.text)

            _logger.info("AI Ollama: Deleted model '%s'", model_name)
            return True

        except requests.ConnectionError:
            raise UserError(_(
                "Cannot connect to Ollama at %(url)s. "
                "Make sure the Ollama server is running.",
                url=base_url,
            ))
