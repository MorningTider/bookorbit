#!/usr/bin/env python3
"""Bind a self-use stable package to the installed native production acceptance."""
import hashlib
import json
import pathlib
import re

CHECKS={'databaseHealthy','copiedBooksQueryable','bookDetail','bundledDownloaderConfigured',
        'fourParallelDetails','nativeHostPathAndRange','frontendServed','anonymousRejected',
        'dedicatedNativeProcess','productionStillHealthy','oldContainerStopped','oldContainerRestartDisabled'}


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def validate(path,source,inventory_sha,controller_sha,migrations_sha,revision,application_version="3.5.0"):
    value=json.loads(pathlib.Path(path).read_text())
    if value.get('kind')!='private-stable-readiness' or value.get('publicationScope')!='private':
        raise ValueError('Self-use stable readiness evidence required')
    installed=value.get('installed',{});api=value.get('api',{})
    version=installed.get('packageVersion','');match=re.fullmatch(re.escape(application_version)+r'-(1[0-9]{4})',version)
    if not match or int(match[1])>=revision:raise ValueError('A newer package revision is required')
    expected={'sourceCommit':source,'payloadInventorySha256':inventory_sha,
              'controllerSha256':controller_sha,'applicationMigrationSha256':migrations_sha}
    if installed.get('productionEnabled') is not True or any(installed.get(k)!=v for k,v in expected.items()):
        raise ValueError('Installed acceptance differs from candidate source, payload, controller or migrations')
    if (api.get('kind')!='installed-native-production-api' or api.get('packageVersion')!=version
        or api.get('passed') is not True or api.get('tokensTransferred') is not False
        or api.get('readOnlyApiRequests') is not True
        or any(api.get('checks',{}).get(name) is not True for name in CHECKS)):
        raise ValueError('Matching production API acceptance required')
    return digest(path)


def apply_metadata(metadata,proof_sha):
    metadata.update(status='private-stable-production-not-public-release',productionEnabled=True,
                    releaseChannel='stable',publicationScope='private',publicRedistributionApproved=False,
                    privateStableReadinessSha256=proof_sha,pending=[])


def apply_info(fields):
    fields.pop('beta',None)
    fields.update(displayname='BookOrbit',description='BookOrbit library management service. Native Synology edition.',
                  description_chs='BookOrbit 图书管理服务（群晖原生版）。')
