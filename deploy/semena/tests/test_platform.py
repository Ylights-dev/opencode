from __future__ import annotations

import json
import os
import pathlib
import re
import sys
import tempfile
import unittest
from contextlib import closing
from io import BytesIO
from urllib.error import HTTPError


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import auth_server  # noqa: E402


class ClientConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = json.loads((ROOT / "client" / "Служебные файлы" / "agent-config.json").read_text(encoding="utf-8"))

    def test_gateway_is_tls_and_not_direct_ollama(self) -> None:
        options = self.config["provider"]["semena"]["options"]
        self.assertEqual(options["baseURL"], "https://10.1.50.101:8443/v1")
        self.assertNotIn("11434", options["baseURL"])

    def test_key_is_injected_not_committed(self) -> None:
        options = self.config["provider"]["semena"]["options"]
        self.assertEqual(options["apiKey"], "{env:SEMENA_AGENT_API_KEY}")

    def test_only_corporate_provider_is_enabled(self) -> None:
        self.assertEqual(self.config["enabled_providers"], ["semena"])
        self.assertEqual(self.config["model"], "semena/semena-gemma4")

    def test_agent_can_choose_tools_and_shell_is_fallback(self) -> None:
        permission = self.config["permission"]
        self.assertEqual(permission["external_directory"], "ask")
        self.assertEqual(permission["bash"], "allow")
        for tool in ["edit", "glob", "grep", "list", "task", "todowrite", "lsp", "skill", "webfetch", "websearch", "read", "write"]:
            self.assertEqual(permission[tool], "allow", tool)
        self.assertNotIn("instructions", self.config)


class DeploymentTests(unittest.TestCase):
    def test_gateway_only_publishes_tls_port(self) -> None:
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        self.assertNotRegex(compose, r'(?m)^\s+-\s*["\']?4000:4000')
        self.assertNotRegex(compose, r'(?m)^\s+-\s*["\']?5432:5432')
        self.assertIn('"8443:8443"', compose)

    def test_no_literal_secret_in_tracked_configuration(self) -> None:
        candidates = [
            ROOT / "compose.yaml",
            ROOT / "auth_server.py",
            ROOT / "client" / "Служебные файлы" / "agent-config.json",
        ]
        secret = re.compile(r"(?:ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,})")
        for path in candidates:
            self.assertIsNone(secret.search(path.read_text(encoding="utf-8")), path)

    def test_installer_pins_version_and_checksum(self) -> None:
        installer = (ROOT / "client" / "onefile" / "Install-SemenaAgentEmbedded.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("__SEMENA_DESKTOP_SETUP_SHA256__", installer)
        self.assertIn("Get-FileHash", installer)
        self.assertIn("Import-Certificate", installer)
        self.assertIn("Semena-Agent-Setup-x64.exe", installer)
        self.assertNotIn("github.com", installer)

    def test_installer_uses_open_webui_login_and_pins_ca_for_runtime(self) -> None:
        installer = (ROOT / "client" / "onefile" / "Install-SemenaAgentEmbedded.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("Введите e-mail от корпоративной веб-панели", installer)
        self.assertIn("Введите пароль от корпоративной веб-панели", installer)
        self.assertIn("$ProgressPreference = 'SilentlyContinue'", installer)
        self.assertIn("https://10.1.50.101:8443/enroll", installer)
        self.assertIn("Invoke-RestMethod -Method Post", installer)
        self.assertNotIn("Enter your", installer)
        self.assertIn("SEMENA_AGENT_API_KEY", installer)
        self.assertIn("GetEnvironmentVariable('SEMENA_AGENT_API_KEY', 'User')", installer)
        self.assertIn("автоматически привязано", installer)

    def test_client_support_directory_only_contains_embedded_data(self) -> None:
        root = ROOT / "client"
        support = root / "Служебные файлы"
        self.assertTrue(support.is_dir())
        self.assertFalse((root / "Установить Семена - Агент.cmd").exists())
        self.assertFalse((root / "Прочти меня - установка.txt").exists())
        self.assertFalse((support / "Install-SemenaAgent.ps1").exists())
        for name in ["AGENTS.md", "agent-config.json", "semena-agent-ca.crt"]:
            self.assertTrue((support / name).is_file(), name)

    def test_onefile_installer_bundle_exists(self) -> None:
        root = ROOT / "client" / "onefile"
        builder = (root / "Build-SemenaAgentSetup.ps1").read_text(encoding="utf-8")
        embedded = (root / "Install-SemenaAgentEmbedded.ps1").read_text(encoding="utf-8")
        self.assertIn("makensis.exe", builder)
        self.assertIn("Semena-Agent-Setup-x64.exe", builder)
        self.assertIn("Semena-Agent-Setup-x64.exe", builder)
        self.assertIn("python-3.13.13-amd64.exe", builder)
        self.assertIn("python-wheels", builder)
        self.assertIn("xlrd-2.0.1-py2.py3-none-any.whl", builder)
        self.assertNotIn("7z.sfx", builder)
        self.assertNotIn("iexpress.exe", builder)
        self.assertIn("Semena-Agent-Setup-x64.exe", embedded)
        self.assertIn("Install-AgentPython", embedded)
        self.assertIn("openpyxl", embedded)
        self.assertIn("xlrd", embedded)
        self.assertIn('import openpyxl, xlrd', embedded)
        self.assertIn("-ArgumentList '/S'", embedded)
        self.assertIn("(Join-Path $configRoot 'AGENTS.md')", embedded)
        self.assertNotIn("Invoke-WebRequest", embedded)
        self.assertIn("Invoke-RestMethod -Method Post", embedded)

    def test_desktop_branding_and_identity_are_isolated(self) -> None:
        desktop = ROOT.parents[1] / "packages" / "desktop"
        builder = (desktop / "electron-builder.config.ts").read_text(encoding="utf-8")
        renderer = (desktop / "src" / "renderer" / "index.html").read_text(encoding="utf-8")
        wordmark = (
            ROOT.parents[1] / "packages" / "ui" / "src" / "v2" / "components" / "wordmark-v2.tsx"
        ).read_text(encoding="utf-8")
        onboarding = (desktop / "src" / "main" / "onboarding.ts").read_text(encoding="utf-8")
        self.assertIn("ru.sibsemena.agent", builder)
        self.assertIn("Семена - Агент", builder)
        self.assertIn("<title>Семена - Агент</title>", renderer)
        self.assertIn("СЕМЕНА - АГЕНТ", wordmark)
        self.assertNotIn("opencode", wordmark.lower())
        self.assertIn("Семена - Агент", onboarding)
        self.assertNotIn("Default Project", onboarding)

    def test_desktop_sidecar_enables_websearch_for_local_provider(self) -> None:
        sidecar = (ROOT.parents[1] / "packages" / "desktop" / "src" / "main" / "sidecar.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn("OPENCODE_ENABLE_PARALLEL", sidecar)
        self.assertIn('OPENCODE_WEBSEARCH_PROVIDER: process.env.OPENCODE_WEBSEARCH_PROVIDER ?? "parallel"', sidecar)
        self.assertIn('process.env.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS ?? "3600000"', sidecar)
        self.assertIn('PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8"', sidecar)
        self.assertIn('PYTHONUTF8: process.env.PYTHONUTF8 ?? "1"', sidecar)

    def test_agent_instructions_define_general_tool_selection_policy(self) -> None:
        instructions = (ROOT / "client" / "Служебные файлы" / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("Сам выбирай подходящие инструменты по цели пользователя", instructions)
        self.assertIn("Не выдавай план или намерение за сделанную работу", instructions)
        self.assertIn("повторно открой результат", instructions)
        self.assertIn("Код возврата `0`", instructions)
        self.assertIn("символ `#` комментирует весь остаток строки", instructions)
        self.assertIn("проверь размер таблицы", instructions)

    def test_semena_provider_uses_general_system_tool_policy(self) -> None:
        system = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "system.ts").read_text(
            encoding="utf-8"
        )
        request = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "llm" / "request.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn('model.providerID === "semena"', system)
        self.assertIn("full descriptions", system)
        self.assertIn('return [PROMPT_SEMENA, PROMPT_DEFAULT]', system)
        self.assertIn("SEMENA_TOOL_ALLOWLIST", request)
        self.assertNotIn("compactTools", request)

    def test_semena_automatically_loads_mandatory_verification_skill(self) -> None:
        skill = (ROOT.parents[1] / "packages" / "opencode" / "src" / "skill" / "index.ts").read_text(
            encoding="utf-8"
        )
        system = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "system.ts").read_text(
            encoding="utf-8"
        )
        prompt = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "prompt.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn('VERIFY_WORK_SKILL_NAME = "verify-work"', skill)
        self.assertIn("The mutating command's own exit code", skill)
        self.assertIn('<mandatory_skill name="${mandatory.name}" loaded="true">', system)
        self.assertIn("This skill is already loaded", system)
        self.assertIn("tools.findLastIndex(isMutation)", prompt)
        self.assertIn('["read", "grep", "lsp"]', prompt)

    def test_spreadsheet_read_supports_generic_structure_discovery(self) -> None:
        read_tool = (ROOT.parents[1] / "packages" / "opencode" / "src" / "tool" / "read.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn("DEFAULT_SPREADSHEET_LIMIT", read_tool)
        self.assertIn("start_row = offset - 1", read_tool)
        self.assertIn("Structure landmarks (original workbook row numbers", read_tool)
        self.assertIn("Column profiles (zero-based indexes", read_tool)
        self.assertIn("A merged header may label several columns", read_tool)
        self.assertIn("infer_subcolumns", read_tool)
        self.assertIn("Inferred physical columns from spanning compound headers", read_tool)
        self.assertIn("stable data rows start at workbook row", read_tool)
        self.assertIn("Pandas selection for", read_tool)
        self.assertIn("Use the displayed workbook row number as offset", read_tool)
        self.assertIn("Attempts: ${failures.join", read_tool)
        self.assertIn('from "node:child_process"', read_tool)
        self.assertNotIn("Bun.spawn", read_tool)

    def test_semena_uses_the_upstream_completion_loop(self) -> None:
        prompt = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "prompt.ts").read_text(
            encoding="utf-8"
        )
        tools = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "tools.ts").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("forceTaskCompletion", prompt)
        self.assertNotIn('toolChoice: format.type === "json_schema" ||', prompt)
        self.assertNotIn("tools.finish_task", tools)
        self.assertIn("SEMENA_TOOL_ERROR_RECOVERY_PROMPT", prompt)
        self.assertIn("SEMENA_MUTATION_AUDIT_PROMPT", prompt)
        self.assertIn("SEMENA_ACTION_INTEGRITY_PROMPT", prompt)
        self.assertIn("mutationAudits < 3", prompt)

    def test_desktop_keeps_upstream_opencode_prompt_loop(self) -> None:
        prompt = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "prompt.ts").read_text(
            encoding="utf-8"
        )
        compaction = (ROOT.parents[1] / "packages" / "opencode" / "src" / "session" / "compaction.ts").read_text(
            encoding="utf-8"
        )
        self.assertIn("compaction.isOverflow", prompt)
        self.assertNotIn("SEMENA_AUTOCONTINUE", prompt)
        self.assertNotIn("semena auto-continue", prompt)
        self.assertNotIn("semena-progress-watchdog", prompt)
        self.assertNotIn("semenaTaskContract", prompt)
        self.assertNotIn("semena-task", prompt)
        self.assertNotIn("Preserve the original request verbatim", compaction)

    def test_windows_public_installer_forces_production_channel(self) -> None:
        desktop = ROOT.parents[1] / "packages" / "desktop"
        package = json.loads((desktop / "package.json").read_text(encoding="utf-8"))
        script = (desktop / "scripts" / "package-win-prod.ts").read_text(encoding="utf-8")
        builder = (ROOT / "client" / "onefile" / "Build-SemenaAgentSetup.ps1").read_text(encoding="utf-8")

        self.assertEqual(package["scripts"]["package:win:prod"], "bun ./scripts/package-win-prod.ts")
        self.assertIn('OPENCODE_CHANNEL: "prod"', script)
        self.assertIn("package:win:prod", builder)

    def test_bootstrap_generates_secrets_and_does_not_overwrite_them(self) -> None:
        bootstrap = (ROOT / "scripts" / "bootstrap.sh").read_text(encoding="utf-8")
        self.assertIn("if [ ! -f .env ]", bootstrap)
        self.assertIn("grep -q '^AUTH_PEPPER='", bootstrap)
        self.assertIn("umask 077", bootstrap)
        self.assertIn("openssl rand", bootstrap)

    def test_model_has_required_context(self) -> None:
        modelfile = (ROOT / "models" / "gemma4.Modelfile").read_text(encoding="utf-8")
        self.assertIn("FROM gemma4:12b", modelfile)
        self.assertIn("PARAMETER num_ctx 32768", modelfile)
        self.assertIn("PARAMETER temperature 0.2", modelfile)

    def test_ca_has_explicit_signing_extensions(self) -> None:
        script = (ROOT / "scripts" / "generate_tls.sh").read_text(encoding="utf-8")
        self.assertIn("basicConstraints=critical,CA:TRUE", script)
        self.assertIn("keyUsage=critical,keyCertSign,cRLSign", script)

    def test_firewall_blocks_employee_bypass_but_keeps_infrastructure(self) -> None:
        rules = (ROOT / "firewall.nft").read_text(encoding="utf-8")
        self.assertIn("tcp dport 11434 drop", rules)
        self.assertIn("10.1.50.47", rules)
        self.assertIn("172.16.0.0/12", rules)
        self.assertNotIn("10.1.50.0/24", rules)

    def test_user_lifecycle_has_admin_wrappers(self) -> None:
        self.assertTrue((ROOT / "scripts" / "new_user.sh").is_file())
        self.assertTrue((ROOT / "scripts" / "revoke_user.sh").is_file())
        self.assertTrue((ROOT / "scripts" / "list_users.sh").is_file())

    def test_enrollment_is_tls_rate_limited_and_not_exposed_by_auth_port(self) -> None:
        nginx = (ROOT / "nginx.conf").read_text(encoding="utf-8")
        compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn("location = /enroll", nginx)
        self.assertIn("zone=enroll_per_ip", nginx)
        self.assertIn("limit_req_status 429", nginx)
        self.assertIn("client_max_body_size 8k", nginx)
        self.assertIn("OPEN_WEBUI_SIGNIN_URL", compose)
        self.assertNotRegex(compose, r'(?m)^\s*ports:\s*\n\s*-.*8080')


class AuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        os.environ["AUTH_DB"] = str(pathlib.Path(self.temp_dir.name) / "auth.db")
        os.environ["AUTH_PEPPER"] = "test-pepper-that-is-longer-than-32-characters"

    def tearDown(self) -> None:
        os.environ.pop("AUTH_DB", None)
        os.environ.pop("AUTH_PEPPER", None)
        self.temp_dir.cleanup()

    def test_create_authenticate_and_revoke(self) -> None:
        result = auth_server.create_user("User@SibSemena.RU")
        self.assertEqual(result["email"], "user@sibsemena.ru")
        self.assertEqual(auth_server.authenticate(result["key"]), result["email"])
        self.assertTrue(auth_server.revoke_user(result["email"]))
        self.assertIsNone(auth_server.authenticate(result["key"]))

    def test_rotating_user_key_invalidates_old_key(self) -> None:
        first = auth_server.create_user("user@example.com")
        second = auth_server.create_user("user@example.com")
        self.assertNotEqual(first["key"], second["key"])
        self.assertIsNone(auth_server.authenticate(first["key"]))
        self.assertEqual(auth_server.authenticate(second["key"]), "user@example.com")

    def test_plaintext_key_is_not_stored(self) -> None:
        result = auth_server.create_user("user@example.com")
        database = pathlib.Path(os.environ["AUTH_DB"]).read_bytes()
        self.assertNotIn(result["key"].encode(), database)

    def test_invalid_email_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            auth_server.create_user("not-an-email")

    def test_open_webui_credentials_are_verified_without_storing_password(self) -> None:
        password = "correct-horse-battery-staple"

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, limit):
                return json.dumps(
                    {"id": "owui-1", "email": "user@example.com", "role": "user"}
                ).encode()

        def opener(request, timeout):
            self.assertEqual(timeout, 10)
            submitted = json.loads(request.data.decode())
            self.assertEqual(submitted, {"email": "user@example.com", "password": password})
            return Response()

        identity = auth_server.verify_open_webui_credentials(
            "User@Example.com", password, opener=opener
        )
        result = auth_server.create_user(identity["email"])
        database = pathlib.Path(os.environ["AUTH_DB"]).read_bytes()
        self.assertEqual(identity["role"], "user")
        self.assertEqual(auth_server.authenticate(result["key"]), "user@example.com")
        self.assertNotIn(password.encode(), database)

    def test_open_webui_rejection_does_not_issue_key(self) -> None:
        def opener(request, timeout):
            raise HTTPError(request.full_url, 401, "Unauthorized", {}, BytesIO())

        with self.assertRaises(auth_server.InvalidCredentialsError):
            auth_server.verify_open_webui_credentials(
                "user@example.com", "wrong-password", opener=opener
            )
        with closing(auth_server.connect()) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM users").fetchone()[0], 0)

    def test_open_webui_identity_must_match_requested_email(self) -> None:
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, limit):
                return json.dumps(
                    {"id": "owui-2", "email": "other@example.com", "role": "admin"}
                ).encode()

        with self.assertRaises(auth_server.InvalidCredentialsError):
            auth_server.verify_open_webui_credentials(
                "user@example.com", "password", opener=lambda request, timeout: Response()
            )


if __name__ == "__main__":
    unittest.main()
