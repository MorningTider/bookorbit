#!/usr/bin/env python3
"""Build a self-use stable SPK from accepted installed production inputs."""
import argparse
import importlib.util
import pathlib

spec=importlib.util.spec_from_file_location('native_spk',pathlib.Path(__file__).with_name('build-acceptance-spk.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--stage',required=True);p.add_argument('--lifecycle-report',required=True)
    p.add_argument('--private-stable-readiness',required=True);p.add_argument('--revision',type=int,required=True);p.add_argument('--output',required=True)
    a=p.parse_args();module.build(a.stage,a.lifecycle_report,a.output,a.revision,private_stable_report=a.private_stable_readiness)
