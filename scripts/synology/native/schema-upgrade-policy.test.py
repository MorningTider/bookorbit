import copy
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('schema_upgrade', HERE / 'schema-upgrade-policy.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SchemaUpgradePolicyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name) / 'package'
        self.state = pathlib.Path(self.temporary.name) / 'state'
        self.root.mkdir()
        self.state.mkdir(mode=0o700)
        (self.root / 'app/migrations').mkdir(parents=True)
        (self.root / 'app/migrations/001.sql').write_text('select 1;')
        (self.root / 'bin').mkdir()
        (self.root / 'bin/node').write_text('#!/bin/sh\necho synthetic-migration >> schema.marker\n')
        (self.root / 'bin/node').chmod(0o755)
        shutil.copyfile(HERE / 'native-service.py', self.root / 'native-service.py')
        self.metadata = {'sourceCommit': 'a' * 40, 'applicationMigrationSha256': m.migration_digest(self.root), 'payloadInventorySha256': 'b' * 64, 'schemaUpgradePolicySha256': m.digest(HERE / 'schema-upgrade-policy.py')}
        self.report = {'kind': 'native-schema-upgrade-acceptance', 'passed': True, 'postgresMajor': 18, **{key: self.metadata[key] for key in ['sourceCommit', 'applicationMigrationSha256', 'payloadInventorySha256']}, 'allowedPreviousMigrationSha256': ['c' * 64, self.metadata['applicationMigrationSha256']], 'checks': {key: True for key in m.REQUIRED_CHECKS}}
        (self.state / 'upgrade-guard.json').write_text(json.dumps({'oldMigrationSha256': 'c' * 64}))
        config = {'schemaVersion': 1, 'mode': 'isolated', 'port': 18185, 'environment': {'DATABASE_URL': 'postgres://synthetic:synthetic@127.0.0.1:5433/bookorbit_spk_pathcheck_synthetic', 'JWT_SECRET': 'j' * 32, 'SETUP_BOOTSTRAP_TOKEN': 's' * 32}}
        (self.state / 'service.json').write_text(json.dumps(config))
        (self.state / 'service.json').chmod(0o600)
        self.write_receipt()

    def write_receipt(self):
        (self.root / 'schema-upgrade-acceptance.json').write_text(json.dumps(self.report))
        self.metadata['schemaUpgradeAcceptanceSha256'] = m.digest(self.root / 'schema-upgrade-acceptance.json')
        (self.root / 'acceptance-build.json').write_text(json.dumps(self.metadata))

    def test_validates_exact_source_payload_migrations_and_previous_schema(self):
        self.assertTrue(m.validate_evidence(self.report, self.metadata, 'c' * 64))
        for key in ['sourceCommit', 'applicationMigrationSha256', 'payloadInventorySha256']:
            changed = copy.deepcopy(self.report)
            changed[key] = 'd' * len(changed[key])
            with self.assertRaises(ValueError):
                m.validate_evidence(changed, self.metadata, 'c' * 64)
        with self.assertRaises(ValueError):
            m.validate_evidence(self.report, self.metadata, 'd' * 64)

    def test_same_schema_upgrade_does_not_require_a_cross_schema_allowlist_entry(self):
        current = self.metadata['applicationMigrationSha256']
        self.report['allowedPreviousMigrationSha256'] = ['c' * 64]
        self.write_receipt()
        (self.state / 'upgrade-guard.json').write_text(json.dumps({'oldMigrationSha256': current}))
        result = m.upgrade(self.root, self.state)
        self.assertTrue(result['passed'])
        self.assertFalse(result['schemaChanged'])
        (self.root / 'app/migrations/001.sql').write_text('select 2;')
        with self.assertRaises(ValueError):
            m.upgrade(self.root, self.state)

    def test_refuses_missing_failed_or_incomplete_verification(self):
        for key in m.REQUIRED_CHECKS:
            changed = copy.deepcopy(self.report)
            changed['checks'][key] = False
            with self.assertRaises(ValueError):
                m.validate_evidence(changed, self.metadata)
        changed = copy.deepcopy(self.report)
        changed['passed'] = False
        with self.assertRaises(ValueError):
            m.validate_evidence(changed, self.metadata)

    def test_changed_schema_without_receipt_remains_rejected(self):
        (self.root / 'schema-upgrade-acceptance.json').unlink()
        with self.assertRaises(ValueError):
            m.upgrade(self.root, self.state)
        self.assertFalse((self.root / 'app/schema.marker').exists())

    def test_unmodified_legacy_schema_without_receipt_is_accepted(self):
        (self.root / 'schema-upgrade-acceptance.json').unlink()
        self.metadata.pop('schemaUpgradeAcceptanceSha256')
        (self.root / 'acceptance-build.json').write_text(json.dumps(self.metadata))
        (self.state / 'upgrade-guard.json').write_text(json.dumps({'oldMigrationSha256': self.metadata['applicationMigrationSha256']}))
        self.assertFalse(m.upgrade(self.root, self.state)['migrationsRun'])

    def test_tampered_receipt_or_migration_is_rejected_before_execution(self):
        (self.root / 'schema-upgrade-acceptance.json').write_text('{}')
        with self.assertRaises(ValueError):
            m.upgrade(self.root, self.state)
        self.write_receipt()
        (self.root / 'app/migrations/001.sql').write_text('select 2;')
        with self.assertRaises(ValueError):
            m.upgrade(self.root, self.state)
        self.assertFalse((self.root / 'app/schema.marker').exists())

    @unittest.skipIf(os.geteuid() == 0, 'The package never runs migration as root')
    def test_runs_the_packaged_program_and_keeps_private_configuration(self):
        before = (self.state / 'service.json').read_bytes()
        result = m.upgrade(self.root, self.state, execute=True)
        self.assertTrue(result['migrationsRun'])
        self.assertTrue((self.root / 'app/schema.marker').exists())
        self.assertEqual((self.state / 'service.json').read_bytes(), before)
        self.assertEqual((self.state / 'schema-upgrade.log').stat().st_mode & 0o777, 0o600)
        self.assertTrue(json.loads((self.state / 'schema-upgrade-result.json').read_text())['passed'])

    @unittest.skipIf(os.geteuid() == 0, 'The package never runs migration as root')
    def test_failed_program_does_not_publish_a_success_result(self):
        (self.root / 'bin/node').write_text('#!/bin/sh\nexit 7\n')
        with self.assertRaises(ValueError):
            m.upgrade(self.root, self.state, execute=True)
        self.assertFalse((self.state / 'schema-upgrade-result.json').exists())


if __name__ == '__main__':
    unittest.main()
