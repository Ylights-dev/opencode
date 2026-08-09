from __future__ import annotations

import json
import os
import pathlib
import re
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import auth_server  # noqa: E402


class ClientConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = json.loads((ROOT / "client" / "opencode.json").read_text(encoding="utf-8"))

    def test_gateway_is_tls_and_not_direct_ollama(self) -> None:
        options = self.config["provider"]["semena"]["options"]
        self.assertEqual(options["baseURL"], "https://10.1.50.101:8443/v1")
        self.assertNotIn("11434", options["baseURL"])

    def test_key_is_injected_not_committed(self) -> None:
        options = self.config["provider"]["semena"]["options"]
        self.assertEqual(options["apiKey"], "{env:SEMENA_OPENCODE_API_KEY}")

    def test_workspace_boundary_and_secret_reads_are_denied(self) -> None:
        permission = self.config["permission"]
        self.assertEqual(permission["external_directory"], "deny")
        self.assertEqual(permission["bash"], "deny")
        self.assertEqual(permission["read"]["*.env"], "deny")
        self.assertEqual(permission["read"]["*.key"], "deny")


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
            ROOT / "client" / "opencode.json",
        ]
        secret = re.compile(r"(?:ghp_|github_pat_|sk-[A-Za-z0-9_-]{20,})")
        for path in candidates:
            self.assertIsNone(secret.search(path.read_text(encoding="utf-8")), path)

    def test_installer_pins_version_and_checksum(self) -> None:
        installer = (ROOT / "client" / "Install-SemenaOpenCode.ps1").read_text(encoding="utf-8")
        self.assertIn("$version = '1.18.15'", installer)
        self.assertRegex(installer, r"\$expectedHash = '[A-F0-9]{64}'")
        self.assertIn("Get-FileHash", installer)
        self.assertIn("Import-Certificate", installer)

    def test_installer_prompts_securely_and_pins_ca_for_runtime(self) -> None:
        installer = (ROOT / "client" / "Install-SemenaOpenCode.ps1").read_text(encoding="utf-8")
        self.assertIn("Read-Host 'Enter your Semena OpenCode access key' -AsSecureString", installer)
        self.assertIn("Copy-Item -LiteralPath $certificatePath", installer)
        self.assertIn("NODE_EXTRA_CA_CERTS", installer)
        self.assertIn("SSL_CERT_FILE", installer)
        self.assertIn("XDG_CONFIG_HOME", installer)
        self.assertIn("XDG_DATA_HOME", installer)
        self.assertIn("XDG_CACHE_HOME", installer)

    def test_bootstrap_generates_secrets_and_does_not_overwrite_them(self) -> None:
        bootstrap = (ROOT / "scripts" / "bootstrap.sh").read_text(encoding="utf-8")
        self.assertIn("if [ ! -f .env ]", bootstrap)
        self.assertIn("grep -q '^AUTH_PEPPER='", bootstrap)
        self.assertIn("umask 077", bootstrap)
        self.assertIn("openssl rand", bootstrap)

    def test_model_has_required_context(self) -> None:
        modelfile = (ROOT / "models" / "qwen35.Modelfile").read_text(encoding="utf-8")
        self.assertIn("FROM qwen3.5:9b", modelfile)
        self.assertIn("PARAMETER num_ctx 16384", modelfile)

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


if __name__ == "__main__":
    unittest.main()
