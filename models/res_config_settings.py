# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import requests

from odoo import api, fields, models
from odoo.exceptions import AccessError

_logger = logging.getLogger(__name__)


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    ollama_base_url = fields.Char(
        string="Ollama Server URL",
        config_parameter='ai.ollama_base_url',
        default='http://ollama:11434',
        help="URL of the Ollama server. Default: http://ollama:11434 (Docker) "
             "or http://localhost:11434 (local install)",
        groups='base.group_system',
    )

    ollama_enabled = fields.Boolean(
        string="Ollama (Local LLM) enabled",
        compute='_compute_ollama_enabled',
        readonly=True,
        groups='base.group_system',
    )

    def _compute_ollama_enabled(self):
        for record in self:
            record.ollama_enabled = bool(record.ollama_base_url)

    def _check_admin(self):
        if not self.env.user.has_group('base.group_system'):
            raise AccessError("Access to Ollama Dashboard is restricted to administrators.")

    def action_ollama_open_dashboard(self):
        """Open the Ollama Dashboard client action."""
        self._check_admin()
        return {
            'type': 'ir.actions.client',
            'tag': 'ai_ollama.Dashboard',
            'name': 'Ollama Dashboard',
        }

    @api.model
    def _get_sidecar_url(self, base_url: str) -> str:
        """Derive sidecar URL from Ollama base URL.

        Ollama:  http://ollama:11434  → Sidecar: http://ollama:11435
        Ollama:  http://localhost:11434 → Sidecar: http://localhost:11435
        """
        return base_url.rstrip("/").replace(":11434", ":11435")

    @api.model
    def get_ollama_dashboard_data(self):
        """RPC endpoint: return all dashboard data as a single JSON dict."""
        self._check_admin()
        base_url = self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")

        result = {
            "connected": False,
            "base_url": base_url,
            "models": [],
            "loaded_models": [],
            "ram": None,
            "gpu": None,
            "disk": None,
        }

        # 1. Installed models via /api/tags
        try:
            resp = requests.get(f"{base_url}/api/tags", timeout=5)
            if resp.status_code == 200:
                result["connected"] = True
                for m in resp.json().get("models", []):
                    result["models"].append({
                        "name": m.get("name", "unknown"),
                        "size_gb": round(m.get("size", 0) / (1024**3), 1),
                        "family": m.get("details", {}).get("family", ""),
                        "parameter_size": m.get("details", {}).get("parameter_size", ""),
                        "quantization": m.get("details", {}).get("quantization_level", ""),
                    })
        except Exception:
            return result

        # 2. Loaded models via /api/ps
        try:
            ps_resp = requests.get(f"{base_url}/api/ps", timeout=3)
            if ps_resp.status_code == 200:
                for m in ps_resp.json().get("models", []):
                    size_vram = m.get("size_vram", 0)
                    size_total = m.get("size", 0)
                    result["loaded_models"].append({
                        "name": m.get("name", "unknown"),
                        "ram_gb": round((size_total - size_vram) / (1024**3), 1),
                        "vram_gb": round(size_vram / (1024**3), 1),
                    })
        except Exception:
            pass

        # 3. System resources via sidecar (replaces docker exec approach)
        result.update(self._query_system_resources(base_url))

        return result

    @api.model
    def get_ollama_metrics(self):
        """RPC endpoint: return real-time metrics (CPU, RAM, Network, GPU).
        Called by the dashboard JS every 2s — proxies to the sidecar so the
        browser never makes a direct HTTP call (avoids Mixed Content errors).
        """
        self._check_admin()
        base_url = self.env["ir.config_parameter"].sudo().get_param(
            "ai.ollama_base_url", "http://ollama:11434"
        ).rstrip("/")
        sidecar_url = self._get_sidecar_url(base_url)
        try:
            resp = requests.get(f"{sidecar_url}/api/metrics", timeout=4)
            if resp.status_code == 200:
                return {"ok": True, "data": resp.json()}
            return {"ok": False, "data": None}
        except Exception as e:
            _logger.debug("AI Ollama: metrics proxy failed: %s", e)
            return {"ok": False, "data": None}

    @api.model
    def _query_system_resources(self, base_url: str) -> dict:
        """Query RAM, GPU, Disk from the Ollama sidecar service.

        The sidecar (FastAPI) runs inside the Ollama container on port 11435
        and exposes /api/system-info. This replaces the previous docker exec approach.
        """
        sidecar_url = self._get_sidecar_url(base_url)

        try:
            resp = requests.get(f"{sidecar_url}/api/system-info", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                info = {}
                if data.get("ram"):
                    info["ram"] = data["ram"]
                if data.get("gpu"):
                    info["gpu"] = data["gpu"]
                if data.get("disk"):
                    info["disk"] = data["disk"]
                return info
            else:
                _logger.warning(
                    "AI Ollama: Sidecar returned status %s from %s",
                    resp.status_code, sidecar_url
                )
        except requests.exceptions.ConnectionError:
            _logger.warning(
                "AI Ollama: Cannot connect to sidecar at %s. "
                "Make sure the custom Ollama image with sidecar is running.",
                sidecar_url
            )
        except Exception as e:
            _logger.debug("AI Ollama: Sidecar query failed: %s", e)

        return {}