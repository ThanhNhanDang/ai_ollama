# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import subprocess
import requests

from odoo import api, fields, models

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

    def action_ollama_open_dashboard(self):
        """Open the Ollama Dashboard client action."""
        return {
            'type': 'ir.actions.client',
            'tag': 'ai_ollama.Dashboard',
            'name': 'Ollama Dashboard',
        }

    @api.model
    def get_ollama_dashboard_data(self):
        """RPC endpoint: return all dashboard data as a single JSON dict."""
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

        # 3. System resources via docker exec
        result.update(self._query_system_resources())

        return result

    @api.model
    def _query_system_resources(self):
        """Query RAM, GPU, Disk from the Ollama container via docker exec."""
        info = {}

        # RAM
        try:
            out = subprocess.run(
                ["docker", "exec", "ollama", "sh", "-c",
                 "cat /proc/meminfo | grep -E 'MemTotal|MemAvailable'"],
                capture_output=True, text=True, timeout=5,
            )
            if out.returncode == 0:
                mem = {}
                for line in out.stdout.strip().split("\n"):
                    parts = line.split()
                    if len(parts) >= 2:
                        mem[parts[0].rstrip(":")] = int(parts[1])
                if "MemTotal" in mem and "MemAvailable" in mem:
                    total = mem["MemTotal"] / (1024 * 1024)
                    available = mem["MemAvailable"] / (1024 * 1024)
                    info["ram"] = {
                        "total_gb": round(total, 1),
                        "available_gb": round(available, 1),
                        "used_gb": round(total - available, 1),
                        "usage_pct": round((total - available) / total * 100) if total > 0 else 0,
                    }
        except Exception as e:
            _logger.debug("AI Ollama: Cannot read RAM info: %s", e)

        # GPU
        try:
            out = subprocess.run(
                ["docker", "exec", "ollama", "nvidia-smi",
                 "--query-gpu=name,memory.total,memory.free,memory.used",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5,
            )
            if out.returncode == 0 and out.stdout.strip():
                parts = [p.strip() for p in out.stdout.strip().split(",")]
                if len(parts) == 4:
                    info["gpu"] = {
                        "name": parts[0],
                        "total_gb": round(int(parts[1]) / 1024, 1),
                        "free_gb": round(int(parts[2]) / 1024, 1),
                        "used_gb": round(int(parts[3]) / 1024, 1),
                        "usage_pct": round(int(parts[3]) / int(parts[1]) * 100) if int(parts[1]) > 0 else 0,
                    }
        except Exception as e:
            _logger.debug("AI Ollama: Cannot read GPU info: %s", e)

        # Disk
        try:
            out = subprocess.run(
                ["docker", "exec", "ollama", "df", "-h", "/root/.ollama"],
                capture_output=True, text=True, timeout=5,
            )
            if out.returncode == 0:
                lines = out.stdout.strip().split("\n")
                if len(lines) >= 2:
                    parts = lines[1].split()
                    if len(parts) >= 5:
                        info["disk"] = {
                            "total": parts[1],
                            "used": parts[2],
                            "free": parts[3],
                            "usage_pct": parts[4].rstrip("%"),
                        }
        except Exception as e:
            _logger.debug("AI Ollama: Cannot read disk info: %s", e)

        return info
